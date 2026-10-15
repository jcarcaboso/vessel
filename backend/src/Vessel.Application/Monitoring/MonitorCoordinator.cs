using Vessel.Application.Common;
using System.Text.Json;
using Vessel.Application.Credentials;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;

namespace Vessel.Application.Monitoring;

public sealed class MonitorCoordinator(IMonitorStore store, IWorkspaceStore workspace, IMonitorImporter executions,
    IVenueRegistry venues, IAccountCredentialReader credentials, IUnitOfWork unitOfWork,
    IVesselEventSink events, IMonitorCommandSink commands, IJournalOwnerContext owner, MonitorOptions options,
    TimeProvider time, IMonitorEvaluator? evaluator = null)
{
    public async Task<MonitorSummaryDto> SummaryAsync(CancellationToken ct)
    {
        var heartbeat = await store.HeartbeatAsync(ct);
        var online = IsOnline(heartbeat?.HeartbeatAtUtc);
        var accounts = new List<AccountMonitorDto>();
        foreach (var row in await store.ListAsync(ct))
        {
            var capture = await store.CaptureAsync(row.AccountId, ct);
            if (capture is not null && EligibleVenue(capture.Account.VenueId) && await store.EligibleAsync(row.AccountId, ct))
                accounts.Add(await ToDto(row, online, ct));
        }
        return new(online, heartbeat?.HeartbeatAtUtc, accounts);
    }

    public async Task<AccountMonitorDto> AccountAsync(Guid id, CancellationToken ct)
    {
        _ = await store.CaptureAsync(id, ct) ?? throw new ProblemException(404, "Account not found.");
        var row = await store.FindAsync(id, ct) ?? new() { AccountId = id, OwnerId = owner.OwnerId };
        return await ToDto(row, IsOnline((await store.HeartbeatAsync(ct))?.HeartbeatAtUtc), ct);
    }

    public async Task<MonitorRunAccepted> RequestAsync(Guid accountId, CancellationToken ct)
    {
        var request = Guid.CreateVersion7();
        await unitOfWork.ExecuteAsync(() => store.LockedAsync(accountId, async (account, row) =>
        {
            if (!account.IsEnabled || account.SourceId is null || !EligibleVenue(account.VenueId) ||
                !await store.EligibleAsync(accountId, ct))
                throw new ProblemException(409, "This account has no eligible venue Plays or pending linked exits.");
            var retry = await RetryAfterAsync(account.VenueId, row, time.GetUtcNow(), ct);
            if (retry > 0) throw new MonitorAdmissionException(retry);
            row.Admit(request, "manual", time.GetUtcNow());
            await commands.EnqueueAsync(new(request, accountId, owner.OwnerId, "manual"), ct);
            return true;
        }, ct), ct);
        return new(request, await AccountAsync(accountId, ct));
    }

    /// <summary>Refresh uses the same account gate and global two-read budget, but can refresh accounts without Plays.</summary>
    public Task<MonitorLease> AdmitRefreshAsync(Guid accountId, string readerId, CancellationToken ct) =>
        unitOfWork.ExecuteAsync(() => store.LockedAsync(accountId, async (account, row) =>
        {
            if (!account.IsEnabled) throw new ProblemException(400, "Enable the account before refreshing it.");
            if (account.SourceId is null || venues.Descriptor(account.VenueId)?.Capabilities.Sync != true)
                throw new ProblemException(400, "This account cannot be refreshed.");
            if (venues.Reader(account.VenueId) is null) throw new ProblemException(503, "Venue reader is unavailable.");
            var now = time.GetUtcNow();
            var retry = await RetryAfterAsync(account.VenueId, row, now, ct);
            if (retry > 0) throw new MonitorAdmissionException(retry);
            if (!await store.ReadCapacityAsync(now, ct)) throw new MonitorAdmissionException(30);
            var request = Guid.CreateVersion7();
            row.Admit(request, "refresh", now);
            row.Claim(request, readerId, now, MonitorOptions.Lease);
            return new MonitorLease(accountId, request, row.Generation, readerId, "refresh");
        }, ct), ct);

    public async Task<bool> RunAsync(MonitorLease lease, CancellationToken ct)
    {
        var capture = await store.CaptureAsync(lease.AccountId, ct);
        if (capture is null) return false;
        var before = await store.FindAsync(lease.AccountId, ct);
        if (before is null || !before.Owns(lease.Generation, lease.WorkerId, time.GetUtcNow())) return false;
        var snapshotApplied = false;
        try
        {
            if (lease.Trigger != "refresh" && !await store.EligibleAsync(lease.AccountId, ct))
                return await FailAsync(lease, capture, false, "This account no longer has monitored Plays or pending exits.", ct);
            // Commit the watched-history baseline before any adapter call.
            await unitOfWork.ExecuteAsync(async () =>
            {
                await events.EnsureMonitoringBaselineAsync(lease.AccountId, ct);
                return true;
            }, ct);
            // A different account may have learned a venue-wide deadline after this lease was claimed.
            // Keep accepted work pending rather than consuming it without a venue observation.
            var deferred = await DeferThrottledLeaseAsync(lease, ct);
            if (deferred != 0)
            {
                if (deferred > 0 && lease.Trigger == "refresh") throw new MonitorAdmissionException(deferred);
                return false;
            }
            if (!capture.Account.IsEnabled || capture.Account.SourceId is null)
                return await FailAsync(lease, capture, false, "Account settings changed before the check.", ct);
            if (lease.Trigger != "refresh" && venues.Descriptor(capture.Account.VenueId)?.Capabilities.ReadOnlyCredential == true &&
                !await credentials.IsUsableAsync(capture.Account, ct))
                return await FailAsync(lease, capture, true, "A usable read-only credential is required. Update it to resume monitoring.", ct);
            var reader = venues.Reader(capture.Account.VenueId) ?? throw new VenueReadException("Reader unavailable.");
            var sync = await reader.ReadAsync(capture.Account, ct);
            if (!sync.Fills.All(VenueFactChecks.Valid))
                throw new VenueReadException("Invalid execution facts.");
            if (lease.Trigger == "refresh")
            {
                // Preserve the public Refresh commit even if the later optional order read is cancelled.
                // This is a short fenced transaction; the lease, not a DB lock, spans the order read.
                if (!await ApplyAsync(lease, capture, new(sync, null), ct, snapshotOnly: true)) return false;
                snapshotApplied = true;
            }
            VenueOrderReadResult? orders = null;
            string? orderError = null;
            var credentialError = false;
            if (venues.Descriptor(capture.Account.VenueId)?.Capabilities.Orders == true)
            {
                try
                {
                    var retryAt = await store.VenueRetryAtAsync(capture.Account.VenueId, ct);
                    if (retryAt > time.GetUtcNow()) throw new VenueRateLimitException(retryAt.Value);
                    if (venues.Descriptor(capture.Account.VenueId)?.Capabilities.ReadOnlyCredential == true &&
                        !await credentials.IsUsableAsync(capture.Account, ct))
                        throw new VenueCredentialRejectedException();
                    orders = await (venues.Orders(capture.Account.VenueId) ?? throw new VenueReadException("Order reader unavailable."))
                        .ReadOrdersAsync(capture.Account, ct);
                    if (!orders.Orders.All(VenueFactChecks.Valid)) throw new VenueReadException("Invalid order facts.");
                }
                catch (Exception ex) when (lease.Trigger == "refresh" &&
                    (ex is not OperationCanceledException || !ct.IsCancellationRequested))
                {
                    // Refresh imports public facts even when private/order coverage is unavailable.
                    // Never expose exception text, which can contain credentials or request URLs.
                    orders = null;
                    if (ex is VenueRateLimitException limited)
                        await store.DeferVenueAsync(capture.Account.VenueId, limited.RetryAtUtc, CancellationToken.None);
                    credentialError = ex is VenueCredentialRejectedException or CredentialStorageException;
                    orderError = credentialError
                        ? "Public account data refreshed; order coverage is unavailable. Update the read-only credential."
                        : ex is VenueRateLimitException
                        ? "Public account data refreshed; the venue rate limit deferred the order check."
                        : "Public account data refreshed; order coverage is unavailable. Retry the account check later.";
                }
            }
            ct.ThrowIfCancellationRequested();
            return await ApplyAsync(lease, capture, new(sync, orders, orderError, credentialError), ct, snapshotApplied: snapshotApplied);
        }
        catch (Exception ex) when (ex is VenueCredentialRejectedException or CredentialStorageException)
        {
            return await FailAsync(lease, capture, true, "The read-only credential is unavailable or was refused. Update it to resume monitoring.", ct, snapshotApplied);
        }
        catch (VenueRateLimitException limited)
        {
            // A throttle is valid even when this account's lease or settings were superseded.
            await store.DeferVenueAsync(capture.Account.VenueId, limited.RetryAtUtc, CancellationToken.None);
            return await FailAsync(lease, capture, false, "The venue rate limit deferred the next account check.", ct, snapshotApplied);
        }
        catch (Exception ex) when (ex is not MonitorAdmissionException &&
            (ex is not OperationCanceledException || !ct.IsCancellationRequested))
        {
            // Do not log exception payloads: HTTP errors may contain credential-bearing request information.
            var credential = venues.Descriptor(capture.Account.VenueId)?.Capabilities.ReadOnlyCredential == true &&
                !await credentials.IsUsableAsync(capture.Account, ct);
            return await FailAsync(lease, capture, credential, credential ?
                "The read-only credential is unavailable or was refused. Update it to resume monitoring." :
                "The venue check failed. Monitoring will retry.", ct, snapshotApplied);
        }
        catch (OperationCanceledException)
        {
            await FailAsync(lease, capture, false, "The account check was interrupted. Monitoring will retry.", CancellationToken.None, snapshotApplied);
            throw;
        }
    }

    private Task<bool> ApplyAsync(MonitorLease lease, MonitorCapture captured, MonitorRead read, CancellationToken ct,
        bool snapshotOnly = false, bool snapshotApplied = false) =>
        unitOfWork.ExecuteAsync(() => store.LockedAsync(lease.AccountId, async (account, row) =>
        {
            await events.SetRunAsync(lease.RequestId, lease.Trigger == "refresh" ? "owner" : "monitor", ct);
            var now = time.GetUtcNow();
            if (!row.Owns(lease.Generation, lease.WorkerId, now)) return false;
            var current = await store.CaptureAsync(account.Id, ct);
            var refresh = lease.Trigger == "refresh";
            // Refresh imports immutable facts even when a ledger timestamp is unchanged. The store
            // leaves equal-time ledger values intact. Checks still require a new observation before
            // reconciliation/confirmation, and a genuinely newer retained observation fences both.
            if (!account.IsEnabled || account.SettingsRevision != captured.Account.SettingsRevision ||
                account.SourceId != captured.Account.SourceId || account.VenueId != captured.Account.VenueId ||
                current?.CredentialRevision != captured.CredentialRevision ||
                (refresh ? row.LastObservationAtUtc > read.Sync.Snapshot.ObservedAtUtc :
                    row.LastObservationAtUtc >= read.Sync.Snapshot.ObservedAtUtc) ||
                read.Orders is { } orderRead && (refresh ? row.LastOrdersObservationAtUtc > orderRead.ObservedAtUtc :
                    row.LastOrdersObservationAtUtc >= orderRead.ObservedAtUtc) ||
                (refresh ? account.LastSyncedAtUtc > read.Sync.Snapshot.ObservedAtUtc :
                    account.LastSyncedAtUtc >= read.Sync.Snapshot.ObservedAtUtc))
            {
                var discardedState = row.State;
                row.Complete(now, options.ManualCooldown, options.Interval, false, error: "Changed settings or a newer observation superseded this check.");
                await ApplyVenueBudgetAsync(account.VenueId, row, ct);
                if (!account.IsEnabled) { row.State = "idle"; row.NextRunAtUtc = null; }
                await StateEventAsync(account.Id, discardedState, row, lease, now, ct);
                return false;
            }
            var oldState = row.State;
            var previousSuccess = row.LastSuccessAtUtc;
            var previousFill = row.NewestFillAtUtc ?? captured.NewestRetainedFillAtUtc;
            var previousDue = row.NextRunAtUtc;
            var observedGap = read.Sync.FillHistoryTruncated == true && previousFill is not null &&
                (read.Sync.OldestRawFillAtUtc is null || read.Sync.OldestRawFillAtUtc > previousFill);
            var gap = !read.Sync.FillHistoryComplete && (row.HasHistoryGap || observedGap);
            row.HasHistoryGap = gap;
            if (!snapshotApplied) await workspace.SaveRefreshAsync(account, read.Sync, ct);
            if (snapshotOnly)
            {
                row.LastObservationAtUtc = read.Sync.Snapshot.ObservedAtUtc;
                return true;
            }
            if (read.Orders is { } orders)
            {
                await executions.RetainAsync(account, orders, ct);
                if (!refresh) await executions.ReconcileAsync(account, orders, read.Sync.Instruments, ct);
                account.RecordOrderHistoryNotice(orders.Notice);
                await workspace.SaveAsync(ct);
                await store.ResolveExitsAsync(account.Id, orders, ct);
                // Eligibility queries must see the resolved watch within this same transaction.
                await unitOfWork.SaveChangesAsync(ct);
            }
            if (read.OrderError is not null)
            {
                account.RecordOrderHistoryNotice(read.OrderError);
                await workspace.SaveAsync(ct);
            }
            var evaluation = refresh ? new MonitorEvaluationResult(row.ConfirmationAtUtc) :
                evaluator is null ? new MonitorEvaluationResult(null) : await evaluator.EvaluateAsync(
                new(lease.RequestId, account, read, previousSuccess, previousFill, gap, lease.Trigger), ct);
            row.LastObservationAtUtc = read.Sync.Snapshot.ObservedAtUtc;
            row.LastOrdersObservationAtUtc = read.Orders?.ObservedAtUtc ?? row.LastOrdersObservationAtUtc;
            var newest = read.Sync.Fills.Count == 0 ? previousFill : read.Sync.Fills.Max(f => f.OccurredAtUtc);
            if (newest > row.NewestFillAtUtc || row.NewestFillAtUtc is null) row.NewestFillAtUtc = newest;
            row.CredentialRevision = captured.CredentialRevision;
            var degraded = read.OrderError is not null || evaluation.Incomplete || gap || !read.Sync.PositionsComplete ||
                !read.Sync.FillHistoryComplete && read.Sync.FillHistoryTruncated is null ||
                read.Orders is { OpenOrdersComplete: false };
            row.Complete(now, options.ManualCooldown, options.NextDelay(0, Random.Shared.NextDouble()), true, degraded,
                credentialError: read.CredentialError,
                error: read.OrderError ?? (gap ? "The venue fill window may have a gap. Missing executions cannot be ruled out." :
                    evaluation.Incomplete ? evaluation.SafeNotice ?? "The account comparison has unknown coverage." :
                    degraded ? "The venue observation has incomplete position, fill-window or open-order coverage." : null));
            // Refresh never performs lifecycle reconciliation. Do not let frequent owner refreshes
            // postpone a scheduled Check (or an outstanding candidate confirmation) indefinitely.
            if (refresh && !read.CredentialError && previousDue is { } due)
                row.NextRunAtUtc = due < row.NextManualAllowedAtUtc ? row.NextManualAllowedAtUtc : due;
            row.ConfirmationAtUtc = evaluation.NextConfirmationAtUtc;
            if (!read.CredentialError && evaluation.NextConfirmationAtUtc is { } deadline)
            {
                var earliest = now.AddSeconds(60);
                if (deadline < earliest) deadline = earliest;
                if (deadline < row.NextManualAllowedAtUtc) deadline = row.NextManualAllowedAtUtc.Value;
                if (deadline < row.NextRunAtUtc) row.NextRunAtUtc = deadline;
            }
            await ApplyVenueBudgetAsync(account.VenueId, row, ct);
            if (!await store.EligibleAsync(account.Id, ct)) { row.State = "idle"; row.NextRunAtUtc = null; }
            await StateEventAsync(account.Id, oldState, row, lease, now, ct);
            if (captured.CredentialExpiresAtUtc is { } expires && expires > now && expires <= now.AddDays(14))
                await events.AppendAsync(new("credential.expiring", lease.RequestId,
                    $"credential:{account.Id}:{captured.CredentialRevision}:expiring", "warning", now, now,
                    new(AccountId: account.Id, VenueId: account.VenueId), new("monitor"),
                    JsonSerializer.SerializeToElement(new { expiresAtUtc = expires })), ct);
            return true;
        }, ct), ct);

    private Task<bool> FailAsync(MonitorLease lease, MonitorCapture expected, bool credential, string error, CancellationToken ct,
        bool snapshotApplied = false) =>
        unitOfWork.ExecuteAsync(() => store.LockedAsync(lease.AccountId, async (account, row) =>
        {
            await events.SetRunAsync(lease.RequestId, lease.Trigger == "refresh" ? "owner" : "monitor", ct);
            var now = time.GetUtcNow();
            if (!row.Owns(lease.Generation, lease.WorkerId, now)) return false;
            var old = row.State;
            var capture = await store.CaptureAsync(lease.AccountId, ct);
            var settingsChanged = account.SettingsRevision != expected.Account.SettingsRevision ||
                account.SourceId != expected.Account.SourceId || capture?.CredentialRevision != expected.CredentialRevision;
            if (settingsChanged)
            {
                credential = false;
                error = "Account settings or credentials changed during the check. The previous result was discarded.";
            }
            row.CredentialRevision = capture?.CredentialRevision;
            if (!settingsChanged && account.IsEnabled && lease.Trigger == "refresh")
            {
                if (snapshotApplied)
                    account.RecordOrderHistoryNotice("Public account data refreshed; order coverage is unavailable because the order check did not complete.");
                else account.RecordSyncFailure();
            }
            row.Complete(now, options.ManualCooldown, options.NextDelay(row.ConsecutiveFailures + 1, Random.Shared.NextDouble()),
                false, credentialError: credential, error: error);
            await ApplyVenueBudgetAsync(account.VenueId, row, ct);
            if (!account.IsEnabled || lease.Trigger != "refresh" && !await store.EligibleAsync(account.Id, ct))
                { row.State = "idle"; row.NextRunAtUtc = null; }
            await StateEventAsync(lease.AccountId, old, row, lease, now, ct);
            return false;
        }, ct), ct);

    private Task<int> DeferThrottledLeaseAsync(MonitorLease lease, CancellationToken ct) =>
        unitOfWork.ExecuteAsync(() => store.LockedAsync(lease.AccountId, async (account, row) =>
        {
            var now = time.GetUtcNow();
            if (!row.Owns(lease.Generation, lease.WorkerId, now)) return -1;
            var deadline = await store.VenueRetryAtAsync(account.VenueId, ct);
            if (!(deadline > now)) return 0;
            row.ManualState = "pending";
            row.LeaseHolder = null;
            row.LeaseUntilUtc = null;
            row.NextRunAtUtc = Later(row.NextRunAtUtc, deadline);
            row.NextManualAllowedAtUtc = Later(row.NextManualAllowedAtUtc, deadline);
            return SecondsUntil(deadline, now);
        }, ct), ct);

    private async Task<int> RetryAfterAsync(string venueId, Domain.Monitoring.MonitorAccount row, DateTimeOffset now, CancellationToken ct) =>
        Math.Max(row.RetryAfter(now), SecondsUntil(await store.VenueRetryAtAsync(venueId, ct), now));

    private async Task ApplyVenueBudgetAsync(string venueId, Domain.Monitoring.MonitorAccount row, CancellationToken ct)
    {
        var deadline = await store.VenueRetryAtAsync(venueId, ct);
        row.NextManualAllowedAtUtc = Later(row.NextManualAllowedAtUtc, deadline);
        if (row.NextRunAtUtc is not null) row.NextRunAtUtc = Later(row.NextRunAtUtc, deadline);
    }

    private static DateTimeOffset? Later(DateTimeOffset? left, DateTimeOffset? right) =>
        left is null || right > left ? right : left;
    private static int SecondsUntil(DateTimeOffset? deadline, DateTimeOffset now) =>
        deadline > now ? (int)Math.Min(int.MaxValue, Math.Ceiling((deadline.Value - now).TotalSeconds)) : 0;

    private Task StateEventAsync(Guid accountId, string old, Domain.Monitoring.MonitorAccount row,
        MonitorLease lease, DateTimeOffset now, CancellationToken ct) => old == row.State ? Task.CompletedTask :
        events.AppendAsync(new("monitor.state-changed", lease.RequestId, $"monitor:{accountId}:{lease.Generation}:{row.State}",
            row.State == "credential-error" ? "warning" : "info", now, now, new(AccountId: accountId),
            new(lease.Trigger == "refresh" ? "owner" : "monitor"),
            JsonSerializer.SerializeToElement(new { previous = old, state = row.State, error = row.Error })), ct);

    private bool EligibleVenue(string venue) => venues.Descriptor(venue) is { Capabilities.Sync: true, Capabilities.Orders: true };
    private bool IsOnline(DateTimeOffset? heartbeat) => heartbeat is { } at && at <= time.GetUtcNow() &&
        time.GetUtcNow() - at <= options.HeartbeatTimeout;
    private async Task<AccountMonitorDto> ToDto(Domain.Monitoring.MonitorAccount row, bool online, CancellationToken ct)
    {
        var account = await store.CaptureAsync(row.AccountId, ct);
        var deadline = account is null ? null : await store.VenueRetryAtAsync(account.Account.VenueId, ct);
        var state = row.State == "live" && row.LastSuccessAtUtc < time.GetUtcNow() - options.Interval * 2 ? "stale" : row.State;
        return new(row.AccountId, state, row.LastAttemptAtUtc, row.LastSuccessAtUtc,
            row.NextRunAtUtc is null ? null : Later(row.NextRunAtUtc, deadline),
            row.ManualState, Later(row.NextManualAllowedAtUtc, deadline), row.Error, online,
            evaluator is null ? [] : await evaluator.ReadAsync(row.AccountId, null, ct));
    }
}

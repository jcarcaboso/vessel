using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Vessel.Application.Events;

namespace Vessel.Persistence.Events.Subscriptions;

public enum DispatchTrigger { Live, CatchUp }

public enum DispatchOutcome
{
    Delivered, Skipped, Expired, RetryScheduled,
    /// <summary>Terminal: attempt cap, unsupported version or a permanent handler failure.</summary>
    Failed,
    InvalidOwner,
    /// <summary>Neither a retained event nor a dedup identity: whatever the message claims, it is not ours.</summary>
    Unknown,
    /// <summary>Pruned (dedup identity only) or retained below the retention floor. Not recorded as handled.</summary>
    Historical,
    AlreadySettled, NotResponsible,
    /// <summary>A pending receipt whose retry deadline has not arrived; catch-up owns it.</summary>
    NotDue,
    /// <summary>Another dispatcher holds the receipt (catch-up only skips; live delivery waits).</summary>
    Busy
}

public readonly record struct DispatchResult(DispatchOutcome Outcome)
{
    /// <summary>Broker action for live delivery: dead-letter for diagnosis, otherwise acknowledge.</summary>
    public bool DeadLetter => Outcome is DispatchOutcome.Failed or DispatchOutcome.InvalidOwner or DispatchOutcome.Unknown;
}

/// <summary>
/// The one dispatcher behind live delivery and catch-up. In one transaction it looks the event up by owner and ID
/// (never trusting the message's sequence or payload), acquires and locks the receipt, checks responsibility,
/// terminal state, expiry, retry deadline and remaining attempts, runs the handler's database-only effects and
/// settles the receipt. A handler failure rolls its effects back; a second short transaction records the attempt.
/// </summary>
public sealed class EventDispatcher(VesselDbContext db, UnitOfWork work, IServiceProvider services,
    TimeProvider time, ILogger<EventDispatcher> logger)
{
    private static readonly string[] Terminal = ["delivered", "skipped", "expired", "failed"];

    public async Task<DispatchResult> DispatchAsync(EventSubscription subscription, Guid ownerId, Guid eventId,
        DispatchTrigger trigger, CancellationToken cancellationToken)
    {
        // The scope's owner was fixed before the context was resolved. A message never chooses it.
        if (ownerId == Guid.Empty || ownerId != db.CurrentOwnerId || eventId == Guid.Empty)
            return new(DispatchOutcome.InvalidOwner);
        var attempt = new Attempt();
        try
        {
            return new(await work.ExecuteAsync(() => DispatchInTransactionAsync(subscription, eventId, trigger, attempt, cancellationToken),
                cancellationToken));
        }
        catch (Exception error) when (attempt.HandlerStarted)
        {
            // Effects rolled back with the unit. Record the attempt durably; never log handler messages.
            logger.LogWarning("Subscription {Subscription} failed event {EventId} with {ErrorType}.",
                subscription.Name, eventId, error.GetType().Name);
            return new(await work.ExecuteAsync(() => RecordFailureAsync(subscription, eventId, attempt.ObservedAttempts,
                error, cancellationToken), cancellationToken));
        }
    }

    private async Task<DispatchOutcome> DispatchInTransactionAsync(EventSubscription subscription, Guid eventId,
        DispatchTrigger trigger, Attempt attempt, CancellationToken ct)
    {
        await LockRetentionSharedAsync(ct);
        var retained = await RetainedAsync(eventId, ct);
        if (retained is null)
            return await KnownIdentityAsync(eventId, ct) ? DispatchOutcome.Historical : DispatchOutcome.Unknown;
        var (sequence, type, expiresAt, payload, floor) = retained.Value;
        if (sequence <= floor) return DispatchOutcome.Historical;
        if (!await ResponsibleAsync(subscription, sequence, type, ct)) return DispatchOutcome.NotResponsible;

        await VesselEventSql.ExecuteAsync(db, """
            INSERT INTO event_receipts(owner_id,subscription,event_id,sequence,state,attempts,max_attempts,next_attempt_at,created_at)
            VALUES(@owner,@name,@id,@sequence,'pending',0,@max,@now,@now) ON CONFLICT DO NOTHING
            """, ct, ("owner", db.CurrentOwnerId), ("name", subscription.Name), ("id", eventId), ("sequence", sequence),
            ("max", subscription.Limits.MaxAttempts), ("now", time.GetUtcNow()));
        var receipt = await LockReceiptAsync(subscription.Name, eventId, skipLocked: trigger == DispatchTrigger.CatchUp, ct);
        if (receipt is null) return DispatchOutcome.Busy;
        var (state, attempts, maxAttempts, nextAttemptAt) = receipt.Value;
        if (Terminal.Contains(state)) return DispatchOutcome.AlreadySettled;
        var now = time.GetUtcNow();
        if (nextAttemptAt > now) return DispatchOutcome.NotDue;
        if (expiresAt is { } expires && expires <= now)
            return await SettleAsync(subscription.Name, eventId, "expired", 0, null, now, ct);
        var message = JsonSerializer.Deserialize<VesselEvent>(payload, VesselEventJson.Options)!;
        if (message.Version > subscription.Limits.SupportedVersion)
            return await SettleAsync(subscription.Name, eventId, "failed", 0, "Unsupported event version.", now, ct);
        if (attempts >= maxAttempts)
            return await SettleAsync(subscription.Name, eventId, "failed", 0, "Attempt limit reached.", now, ct);

        var handler = services.GetRequiredKeyedService<IVesselEventSubscriber>(subscription.Name);
        attempt.ObservedAttempts = attempts;
        attempt.HandlerStarted = true;
        var handled = await handler.HandleAsync(message, ct);
        attempt.HandlerStarted = false;
        return await SettleAsync(subscription.Name, eventId, handled == EventHandling.Skipped ? "skipped" : "delivered",
            1, null, time.GetUtcNow(), ct);
    }

    private async Task<DispatchOutcome> RecordFailureAsync(EventSubscription subscription, Guid eventId, int observedAttempts,
        Exception error, CancellationToken ct)
    {
        await LockRetentionSharedAsync(ct);
        if (await RetainedAsync(eventId, ct) is not { } retained || retained.Sequence <= retained.Floor)
            return DispatchOutcome.Historical;
        var now = time.GetUtcNow();
        await VesselEventSql.ExecuteAsync(db, """
            INSERT INTO event_receipts(owner_id,subscription,event_id,sequence,state,attempts,max_attempts,next_attempt_at,created_at)
            VALUES(@owner,@name,@id,@sequence,'pending',0,@max,@now,@now) ON CONFLICT DO NOTHING
            """, ct, ("owner", db.CurrentOwnerId), ("name", subscription.Name), ("id", eventId), ("sequence", retained.Sequence),
            ("max", subscription.Limits.MaxAttempts), ("now", now));
        if (await LockReceiptAsync(subscription.Name, eventId, skipLocked: false, ct) is not { } receipt)
            return DispatchOutcome.Busy;
        // Another dispatcher settled or attempted it after this attempt's rollback: its record stands.
        if (Terminal.Contains(receipt.State)) return DispatchOutcome.AlreadySettled;
        if (receipt.Attempts != observedAttempts) return DispatchOutcome.NotDue;
        var attempts = receipt.Attempts + 1;
        var reason = error is TerminalEventException ? Safe(error.Message) : $"Handler failed ({error.GetType().Name}).";
        if (error is TerminalEventException || attempts >= receipt.MaxAttempts)
            return await SettleAsync(subscription.Name, eventId, "failed", 1, reason, now, ct);
        var next = now + subscription.Limits.RetryDelay(attempts, Random.Shared.NextDouble());
        await VesselEventSql.ExecuteAsync(db, """
            UPDATE event_receipts SET attempts=attempts+1,next_attempt_at=@next,error=@error
            WHERE owner_id=@owner AND subscription=@name AND event_id=@id
            """, ct, ("owner", db.CurrentOwnerId), ("name", subscription.Name), ("id", eventId), ("next", next), ("error", reason));
        return DispatchOutcome.RetryScheduled;
    }

    private async Task<DispatchOutcome> SettleAsync(string subscription, Guid eventId, string state, int attempt,
        string? error, DateTimeOffset now, CancellationToken ct)
    {
        await VesselEventSql.ExecuteAsync(db, """
            UPDATE event_receipts SET state=@state,attempts=attempts+@attempt,settled_at=@now,error=@error
            WHERE owner_id=@owner AND subscription=@name AND event_id=@id
            """, ct, ("owner", db.CurrentOwnerId), ("name", subscription), ("id", eventId), ("state", state),
            ("attempt", attempt), ("now", now), ("error", error));
        return state switch
        {
            "delivered" => DispatchOutcome.Delivered,
            "skipped" => DispatchOutcome.Skipped,
            "expired" => DispatchOutcome.Expired,
            _ => DispatchOutcome.Failed
        };
    }

    private Task LockRetentionSharedAsync(CancellationToken ct) =>
        VesselEventSql.ScalarAsync(db, "SELECT pg_advisory_xact_lock_shared(@key)", ct, ("key", VesselEventSql.RetentionLock(db.CurrentOwnerId)));

    private async Task<(long Sequence, string Type, DateTimeOffset? ExpiresAt, string Payload, long Floor)?> RetainedAsync(
        Guid eventId, CancellationToken ct)
    {
        await using var command = VesselEventSql.TransactionCommand(db, """
            SELECT e.sequence,e.type,e.expires_at,e.payload::text,c.retention_floor
            FROM events e JOIN event_cursors c ON c.owner_id=e.owner_id
            WHERE e.owner_id=@owner AND e.event_id=@id
            """, ("owner", db.CurrentOwnerId), ("id", eventId));
        await using var row = await command.ExecuteReaderAsync(ct);
        if (!await row.ReadAsync(ct)) return null;
        return (row.GetInt64(0), row.GetString(1), row.IsDBNull(2) ? null : row.GetFieldValue<DateTimeOffset>(2),
            row.GetString(3), row.GetInt64(4));
    }

    private async Task<bool> KnownIdentityAsync(Guid eventId, CancellationToken ct) =>
        await VesselEventSql.ScalarAsync(db, "SELECT 1 FROM event_dedup WHERE owner_id=@owner AND event_id=@id LIMIT 1",
            ct, ("owner", db.CurrentOwnerId), ("id", eventId)) is not null;

    private async Task<bool> ResponsibleAsync(EventSubscription subscription, long sequence, string type, CancellationToken ct)
    {
        await using var command = VesselEventSql.TransactionCommand(db, """
            SELECT responsible_from,filter_fingerprint FROM event_subscriptions
            WHERE owner_id=@owner AND name=@name FOR KEY SHARE
            """, ("owner", db.CurrentOwnerId), ("name", subscription.Name));
        await using var row = await command.ExecuteReaderAsync(ct);
        if (!await row.ReadAsync(ct)) return false;
        if (row.GetString(1) != subscription.Fingerprint)
        {
            // Registrations are immutable; a host built with a different filter must not settle receipts.
            logger.LogWarning("Subscription {Subscription} is registered with a different filter; not dispatching.", subscription.Name);
            return false;
        }
        return sequence > row.GetInt64(0) && subscription.Matches(type);
    }

    private async Task<(string State, int Attempts, int MaxAttempts, DateTimeOffset NextAttemptAt)?> LockReceiptAsync(
        string subscription, Guid eventId, bool skipLocked, CancellationToken ct)
    {
        await using var command = VesselEventSql.TransactionCommand(db, $"""
            SELECT state,attempts,max_attempts,next_attempt_at FROM event_receipts
            WHERE owner_id=@owner AND subscription=@name AND event_id=@id FOR UPDATE{(skipLocked ? " SKIP LOCKED" : "")}
            """, ("owner", db.CurrentOwnerId), ("name", subscription), ("id", eventId));
        await using var row = await command.ExecuteReaderAsync(ct);
        if (!await row.ReadAsync(ct)) return null;
        return (row.GetString(0), row.GetInt32(1), row.GetInt32(2), row.GetFieldValue<DateTimeOffset>(3));
    }

    private static string Safe(string message) => message.Length <= 200 ? message : message[..200];

    private sealed class Attempt
    {
        public bool HandlerStarted { get; set; }
        public int ObservedAttempts { get; set; }
    }
}

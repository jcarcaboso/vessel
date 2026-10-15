using Vessel.Application.Common;
using System.Globalization;
using System.Text.Json;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Vessel.Application.Workspace;
using Vessel.Domain.Plays;

namespace Vessel.Persistence.Events;

public sealed partial class VesselEventStore(VesselDbContext db, VesselEventMutationCapture mutations,
    IVesselEventOutbox outbox, IOptions<VesselEventSettings> settings, ILogger<VesselEventStore> logger)
    : IVesselEventSink, IVesselEventReader, IUnitOfWorkParticipant, IMonitorCommandSink
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };
    private readonly List<VesselEventDraft> pending = [];
    private readonly List<MonitorAccountCommand> commands = [];
    private Guid runId = Guid.CreateVersion7();
    private string trigger = "owner";

    // Memory-only callback: takes an atomic participation lease and always completes synchronously.
    public void SetRun(Guid id, string source) => VesselEventSql.ParticipateAsync(db, () =>
    {
        if (id == Guid.Empty || source is not ("owner" or "monitor"))
            throw new ArgumentException("Invalid event run.");
        runId = id; trigger = source;
        return Task.CompletedTask;
    }, CancellationToken.None).GetAwaiter().GetResult();

    public Task AppendAsync(VesselEventDraft draft, CancellationToken cancellationToken) => VesselEventSql.ParticipateAsync(db, () =>
    {
        if (!VesselEventValues.Types.Contains(draft.Type) || draft.Version != 1 || draft.RunId == Guid.Empty ||
            string.IsNullOrWhiteSpace(draft.DedupKey) || draft.DedupKey.Length > 1024 ||
            draft.Severity is not ("info" or "warning" or "critical") ||
            draft.Timeliness is not ("timely" or "late") || draft.Relevance is not ("current" or "superseded") ||
            draft.Source.Trigger is not ("owner" or "monitor") || draft.Data.ValueKind != JsonValueKind.Object ||
            Encoding.UTF8.GetByteCount(draft.Data.GetRawText()) > 32_768 ||
            !ValidIds(draft.Source.OrderIds) || !ValidIds(draft.Source.FillIds))
            throw new ArgumentException("Invalid event.");
        // Clone so disposing the producer's JsonDocument cannot invalidate the buffered event.
        pending.Add(draft with
        {
            Data = draft.Data.Clone(),
            Source = draft.Source with { OrderIds = draft.Source.OrderIds?.ToArray(), FillIds = draft.Source.FillIds?.ToArray() }
        });
        return Task.CompletedTask;
    }, cancellationToken);

    private static bool ValidIds(string[]? ids) => ids is null ||
        ids.Length <= 200 && ids.All(id => !string.IsNullOrWhiteSpace(id) && id.Length <= 256);

    public Task EnqueueAsync(MonitorAccountCommand command, CancellationToken cancellationToken) => VesselEventSql.ParticipateAsync(db, async () =>
    {
        if (command.OwnerId != db.CurrentOwnerId || command.RequestId == Guid.Empty ||
            command.Trigger is not ("manual" or "scheduled") ||
            !await db.Accounts.AnyAsync(a => a.Id == command.AccountId && a.IsEnabled, cancellationToken))
            throw new ProblemException(409, "The account is not eligible for monitoring.");
        VesselEventSql.RequireTransaction(db);
        commands.Add(command);
    }, cancellationToken);

    public Task EnsureMonitoringBaselineAsync(Guid accountId, CancellationToken cancellationToken) => VesselEventSql.ParticipateAsync(db, async () =>
    {
        if (!await db.Accounts.AnyAsync(a => a.Id == accountId && a.IsEnabled, cancellationToken))
            throw new ProblemException(404, "Account not found.");
        // First insert wins and commits with every existing source identity. A rollback leaves neither.
        await using var command = VesselEventSql.TransactionCommand(db, """
            WITH baseline AS (
                INSERT INTO event_baselines(owner_id,account_id,started_at)
                VALUES(@owner,@account,@now) ON CONFLICT DO NOTHING RETURNING owner_id
            )
            INSERT INTO event_fills(owner_id,account_id,contract_id,source_fill_id)
                SELECT f."OwnerId",f."AccountId",f."ContractId",f."SourceFillId"
                FROM imported_fills f, baseline b WHERE f."OwnerId"=@owner AND f."AccountId"=@account
            ON CONFLICT DO NOTHING
            """, ("owner", db.CurrentOwnerId), ("account", accountId), ("now", DateTimeOffset.UtcNow));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }, cancellationToken);

    public Task BeforeCommitAsync(CancellationToken cancellationToken) => VesselEventSql.ParticipateAsync(db, async () =>
    {
        await CaptureMutationsAsync(cancellationToken);
        if (pending.Count != 0)
        {
            // No nextval. This row lock remains held until the OUTER transaction completes.
            await using (var create = VesselEventSql.TransactionCommand(db, """
                INSERT INTO event_cursors(owner_id) VALUES(@owner) ON CONFLICT DO NOTHING
                """, ("owner", db.CurrentOwnerId)))
                await create.ExecuteNonQueryAsync(cancellationToken);
            await using (var locked = VesselEventSql.TransactionCommand(db, """
                SELECT sequence FROM event_cursors WHERE owner_id=@owner FOR UPDATE
                """, ("owner", db.CurrentOwnerId)))
                await locked.ExecuteScalarAsync(cancellationToken);
            foreach (var draft in pending)
                await PersistAsync(draft, cancellationToken);
        }
        foreach (var command in commands) await outbox.StageAsync(command, cancellationToken);
        // There is no SaveChangesAndFlushMessagesAsync here. Raw envelope writes enlist in db's actual transaction.
    }, cancellationToken);

    public async Task AfterCommitAsync(CancellationToken cancellationToken)
    {
        try { await outbox.FlushAsync(CancellationToken.None); }
        catch (Exception)
        {
            // The commit succeeded. Recovery owns the durable envelopes; do not invite an API mutation retry.
            logger.LogWarning("Event dispatch is deferred to durable recovery after a successful commit.");
        }
        finally { Reset(); }
    }

    public Task RollbackAsync(CancellationToken cancellationToken)
    {
        Reset();
        return Task.CompletedTask;
    }

    private void Reset()
    {
        pending.Clear(); commands.Clear(); mutations.Clear(); outbox.Reset();
        runId = Guid.CreateVersion7(); trigger = "owner";
    }

    private async Task PersistAsync(VesselEventDraft draft, CancellationToken ct)
    {
        await ValidateSubjectAsync(draft.Subject, ct);
        var id = Guid.CreateVersion7();
        await using (var claim = VesselEventSql.TransactionCommand(db, """
            INSERT INTO event_dedup(owner_id,dedup_key,event_id) VALUES(@owner,@key,@id)
            ON CONFLICT DO NOTHING RETURNING event_id
            """, ("owner", db.CurrentOwnerId), ("key", draft.DedupKey), ("id", id)))
            if (await claim.ExecuteScalarAsync(ct) is null) return;

        long sequence;
        await using (var cursor = VesselEventSql.TransactionCommand(db, """
            UPDATE event_cursors SET sequence=sequence+1 WHERE owner_id=@owner RETURNING sequence
            """, ("owner", db.CurrentOwnerId)))
            sequence = (long)(await cursor.ExecuteScalarAsync(ct))!;
        var message = new VesselEvent(id, draft.Type, draft.Version, db.CurrentOwnerId,
            sequence.ToString(CultureInfo.InvariantCulture), draft.RunId, draft.DedupKey, draft.Severity,
            draft.OccurredAt.ToUniversalTime(), draft.DetectedAt.ToUniversalTime(), draft.Timeliness,
            draft.Relevance, draft.ExpiresAt?.ToUniversalTime(), draft.Subject, draft.Source, draft.Data);
        await using (var insert = VesselEventSql.TransactionCommand(db, """
            INSERT INTO events(owner_id,sequence,event_id,type,detected_at,payload)
            VALUES(@owner,@sequence,@id,@type,@detected,CAST(@payload AS jsonb))
            """, ("owner", db.CurrentOwnerId), ("sequence", sequence), ("id", id), ("type", draft.Type),
            ("detected", message.DetectedAt), ("payload", JsonSerializer.Serialize(message, Json))))
            await insert.ExecuteNonQueryAsync(ct);
        foreach (var consumer in settings.Value.DurableConsumers.Distinct(StringComparer.Ordinal))
        {
            await using var delivery = VesselEventSql.TransactionCommand(db, """
                INSERT INTO event_deliveries(owner_id,event_id,consumer) VALUES(@owner,@id,@consumer)
                """, ("owner", db.CurrentOwnerId), ("id", id), ("consumer", consumer));
            await delivery.ExecuteNonQueryAsync(ct);
        }
        var envelopes = await outbox.StageAsync(message, ct);
        foreach (var envelope in envelopes)
        {
            await using var publication = VesselEventSql.TransactionCommand(db, """
                INSERT INTO event_envelopes(owner_id,event_id,schema_name,envelope_id)
                VALUES(@owner,@id,@schema,@envelope)
                """, ("owner", db.CurrentOwnerId), ("id", id), ("schema", envelope.Schema), ("envelope", envelope.EnvelopeId));
            await publication.ExecuteNonQueryAsync(ct);
        }
    }

    private async Task ValidateSubjectAsync(VesselEventSubject subject, CancellationToken ct)
    {
        if (subject.AccountId is { } accountId && !await db.Accounts.AnyAsync(a => a.Id == accountId, ct))
            throw new ProblemException(404, "Event account not found.");
        if (subject.PlayId is { } playId && !await db.Plays.AnyAsync(p => p.Id == playId &&
            (!subject.AccountId.HasValue || p.AccountId == subject.AccountId), ct))
            throw new ProblemException(404, "Event Play not found.");
    }

    public Task<VesselEventPage> ReadAsync(long after, int limit, CancellationToken cancellationToken) =>
        new VesselEventHistory(db).ReadAsync(after, limit, cancellationToken);
}

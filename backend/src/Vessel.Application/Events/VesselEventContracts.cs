using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Vessel.Domain.Numerics;

namespace Vessel.Application.Events;

public sealed record VesselEventSubject(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? AccountId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? VenueId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ContractId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PlayId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? EntryId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? LevelId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? DiscrepancyId = null);
public sealed record VesselEventSource(string Trigger,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? OrderIds = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? FillIds = null);

public sealed record VesselEventDraft(string Type, Guid RunId, string DedupKey, string Severity,
    DateTimeOffset OccurredAt, DateTimeOffset DetectedAt, VesselEventSubject Subject, VesselEventSource Source,
    JsonElement Data, string Timeliness = "timely", string Relevance = "current", DateTimeOffset? ExpiresAt = null,
    int Version = 1);

public sealed record VesselEvent(Guid Id, string Type, int Version, Guid OwnerId, string Sequence, Guid RunId,
    string DedupKey, string Severity, DateTimeOffset OccurredAt, DateTimeOffset DetectedAt,
    string Timeliness, string Relevance, DateTimeOffset? ExpiresAt, VesselEventSubject Subject,
    VesselEventSource Source, JsonElement Data);

/// <summary>A bounded page. <paramref name="NextCursor"/> carries the stream epoch with the sequence.</summary>
public sealed record VesselEventPage(IReadOnlyList<VesselEvent> Events, string NextCursor, bool ResetRequired);

public interface IVesselEventSink
{
    /// <summary>Buffer an actual mutation in the active unit of work, not a re-read observation.</summary>
    Task AppendAsync(VesselEventDraft draft, CancellationToken cancellationToken);
    /// <summary>Set the identity of the run or owner action for events captured in the active unit of work.</summary>
    Task SetRunAsync(Guid runId, string trigger, CancellationToken cancellationToken);
    /// <summary>Call and commit before the first venue read; already imported fills are historical.</summary>
    Task EnsureMonitoringBaselineAsync(Guid accountId, CancellationToken cancellationToken);
}

public interface IVesselEventReader
{
    /// <summary>Committed events after <paramref name="cursor"/>; another epoch, a pruned or a future cursor resets.</summary>
    Task<VesselEventPage> ReadAsync(string? cursor, int limit, CancellationToken cancellationToken);
}

/// <summary>Browser cursor: <c>{epoch}.{sequence}</c>, or <c>0</c> for the start of a stream not yet seen.</summary>
public readonly record struct VesselEventCursor(Guid? Epoch, long Sequence)
{
    public static bool TryParse(string? value, out VesselEventCursor cursor)
    {
        cursor = default;
        if (string.IsNullOrEmpty(value) || value == "0") return true;
        var dot = value.IndexOf('.');
        if (dot != 32 || !Guid.TryParseExact(value[..dot], "N", out var epoch) || epoch == Guid.Empty ||
            !long.TryParse(value[(dot + 1)..], NumberStyles.None, CultureInfo.InvariantCulture, out var sequence))
        {
            // A bare sequence predates epochs; it parses so the reader can answer with a reset.
            if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var legacy)) return false;
            cursor = new(null, legacy);
            return true;
        }
        cursor = new(epoch, sequence);
        return true;
    }

    public static string Format(Guid? epoch, long sequence) => epoch is { } value
        ? value.ToString("N") + "." + sequence.ToString(CultureInfo.InvariantCulture)
        : sequence.ToString(CultureInfo.InvariantCulture);
}

public static class VesselEventValues
{
    public static string Exact(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    public static string Sum(IEnumerable<decimal> values) =>
        values.Aggregate(default(ExactAmount), (sum, value) => sum + ExactAmount.From(value)).ToString();
    public static string? AveragePrice(IEnumerable<(decimal Price, decimal Quantity)> values)
    {
        var rows = values.ToList();
        var quantity = rows.Aggregate(default(ExactAmount), (sum, row) => sum + ExactAmount.From(row.Quantity));
        var notional = rows.Aggregate(BigInteger.Zero,
            (sum, row) => sum + ExactAmount.From(row.Price).Units * ExactAmount.From(row.Quantity).Units);
        return ExactAmount.Average(notional, quantity);
    }
    public static readonly string[] Types =
    [
        "play.opened", "play.closed", "play.status-changed", "execution.filled", "link.needs-confirmation",
        "execution.link-changed", "discrepancy.opened", "discrepancy.resolved", "monitor.state-changed",
        "monitor.run-completed", "credential.expiring"
    ];
}

using System.Globalization;
using System.Text.Json;
using System.Numerics;
using System.Text.Json.Serialization;
using Vessel.Domain.Numerics;

namespace Vessel.Application.Events;

public sealed record PlayEventSubject(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? AccountId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? VenueId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ContractId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PlayId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? EntryId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? LevelId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? DiscrepancyId = null);
public sealed record PlayEventSource(string Trigger,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? OrderIds = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? FillIds = null);

public sealed record PlayEventDraft(string Type, Guid RunId, string DedupKey, string Severity,
    DateTimeOffset OccurredAt, DateTimeOffset DetectedAt, PlayEventSubject Subject, PlayEventSource Source,
    JsonElement Data, string Timeliness = "timely", string Relevance = "current", DateTimeOffset? ExpiresAt = null,
    int Version = 1);

public sealed record PlayEvent(Guid Id, string Type, int Version, Guid OwnerId, string Sequence, Guid RunId,
    string DedupKey, string Severity, DateTimeOffset OccurredAt, DateTimeOffset DetectedAt,
    string Timeliness, string Relevance, DateTimeOffset? ExpiresAt, PlayEventSubject Subject,
    PlayEventSource Source, JsonElement Data);
public sealed record PlayEventPage(IReadOnlyList<PlayEvent> Events, string NextSequence, bool ResetRequired);

public interface IPlayEventSink
{
    /// <summary>Buffer an actual mutation in the active unit of work, not a re-read observation.</summary>
    Task AppendAsync(PlayEventDraft draft, CancellationToken cancellationToken);
    /// <summary>Set the identity of the monitor run for automatically captured mutations.</summary>
    void SetRun(Guid runId, string trigger);
    /// <summary>Call and commit before the first venue read; already imported fills are historical.</summary>
    Task EnsureMonitoringBaselineAsync(Guid accountId, CancellationToken cancellationToken);
}

public interface IPlayEventReader
{
    Task<PlayEventPage> ReadAsync(long after, int limit, CancellationToken cancellationToken);
}

public static class PlayEventValues
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
    public static bool TrySequence(string? value, out long sequence) =>
        long.TryParse(value ?? "0", NumberStyles.None, CultureInfo.InvariantCulture, out sequence) && sequence >= 0;
    public static readonly string[] Types =
    [
        "play.opened", "play.closed", "play.status-changed", "execution.filled", "link.needs-confirmation",
        "execution.link-changed", "discrepancy.opened", "discrepancy.resolved", "monitor.state-changed",
        "credential.expiring"
    ];
}

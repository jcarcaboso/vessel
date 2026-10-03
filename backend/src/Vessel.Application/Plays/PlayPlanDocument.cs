using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Vessel.Application.Workspace;

namespace Vessel.Application.Plays;

/// <summary>
/// A stop or target of one entry. A percent value is the return on margin at the plan's leverage, so the
/// price distance from the entry is the value divided by the leverage. Share is the part of the entry it closes.
/// </summary>
public sealed record PlanExit(string Id, string Unit, string Value, string Share);
public sealed record PlanEntry(string Id, string Name, string Color, string Share, string Price, IReadOnlyList<PlanExit> Stops, IReadOnlyList<PlanExit> Targets);
public sealed record PlanNotes(string Thesis, string Invalidation, string Strategy, string Evidence);

/// <summary>
/// What the owner intends: direction, sizing, entries with their exits, and the pre-trade notes. Number
/// fields keep the exact text entered; a Draft may leave them blank. Plan revisions snapshot this document.
/// </summary>
public sealed record PlayPlanDocument(string Direction, string SizingMode, string Size, string Leverage, string? BudgetOverride,
    IReadOnlyList<PlanEntry> Entries, PlanNotes Notes);

/// <summary>Validates and normalizes plans and chart drawings before they are stored.</summary>
public static partial class PlayDocuments
{
    public const int MaxEntries = 20;
    public const int MaxTargets = 10;
    public const int MaxStops = 10;
    public const int MaxNoteLength = 20000;
    public const int MaxDrawingsLength = 1_000_000;
    public const int MaxDrawingInstruments = 100;
    public const int MaxDrawingsPerInstrument = 200;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static PlayPlanDocument Normalize(PlayPlanDocument? plan)
    {
        if (plan is null) throw Invalid("A plan is required.");
        if (plan.Direction is not ("long" or "short")) throw Invalid("Direction must be long or short.");
        if (plan.SizingMode is not ("margin" or "quantity")) throw Invalid("Sizing must be margin or quantity.");
        if (plan.Leverage is null || !int.TryParse(plan.Leverage, NumberStyles.None, CultureInfo.InvariantCulture, out var leverage) ||
            leverage is < 1 or > 100 || plan.Leverage != leverage.ToString(CultureInfo.InvariantCulture))
            throw Invalid("Leverage must be a whole number from 1 to 100.");
        if (plan.Entries is not { Count: > 0 and <= MaxEntries }) throw Invalid($"A plan has 1 to {MaxEntries} entries.");
        if (plan.Notes is null) throw Invalid("Plan notes are required.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        string Id(string? id) => id is not null && IdPattern().IsMatch(id) && ids.Add(id) ? id : throw Invalid("Plan items need unique IDs.");
        var entries = plan.Entries.Select(entry =>
        {
            if (entry is null || entry.Stops is null || entry.Targets is null) throw Invalid("Entries need stop and target lists.");
            if (entry.Targets.Count > MaxTargets) throw Invalid($"An entry has at most {MaxTargets} targets.");
            if (entry.Stops.Count > MaxStops) throw Invalid($"An entry has at most {MaxStops} stops.");
            if (entry.Name is null || entry.Name.Length is 0 or > 100 || entry.Name.Any(char.IsControl)) throw Invalid("Entry names need 1 to 100 characters.");
            if (entry.Color is null || !ColorPattern().IsMatch(entry.Color)) throw Invalid("Entry colours must be #rrggbb.");
            return new PlanEntry(Id(entry.Id), entry.Name, entry.Color.ToLowerInvariant(), Number(entry.Share), Number(entry.Price),
                Exits(entry.Stops, "Stops"), Exits(entry.Targets, "Targets"));
        }).ToList();
        List<PlanExit> Exits(IEnumerable<PlanExit> exits, string kind) => exits.Select(exit => exit is null ? throw Invalid($"{kind} must not be null.")
            : new PlanExit(Id(exit.Id), Unit(exit.Unit), Number(exit.Value), Number(exit.Share))).ToList();
        return new PlayPlanDocument(plan.Direction, plan.SizingMode, Number(plan.Size), plan.Leverage,
            plan.BudgetOverride is null ? null : Number(plan.BudgetOverride), entries,
            new PlanNotes(Note(plan.Notes.Thesis), Note(plan.Notes.Invalidation), Note(plan.Notes.Strategy), Note(plan.Notes.Evidence)));
    }

    /// <summary>A plan is ready to commit when at least one entry has a positive price.</summary>
    public static void RequirePlannable(PlayPlanDocument plan)
    {
        if (!plan.Entries.Any(entry => decimal.TryParse(entry.Price, NumberStyles.Float, CultureInfo.InvariantCulture, out var price) && price > 0))
            throw new WorkspaceException(409, "Give at least one entry a price before planning.");
    }

    public static string Serialize(PlayPlanDocument plan) => JsonSerializer.Serialize(plan, Json);
    public static PlayPlanDocument Read(string stored) => JsonSerializer.Deserialize<PlayPlanDocument>(stored, Json)!;

    /// <summary>Chart drawings keyed by venue instrument. Their shape belongs to the chart; only bounds are checked here.</summary>
    public static string NormalizeDrawings(JsonElement? drawings)
    {
        if (drawings is not { } value || value.ValueKind == JsonValueKind.Null) return "{}";
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("Drawings must be an object keyed by instrument.");
        var count = 0;
        foreach (var instrument in value.EnumerateObject())
        {
            if (++count > MaxDrawingInstruments) throw Invalid($"Drawings are kept for at most {MaxDrawingInstruments} instruments.");
            if (instrument.Name.Length is 0 or > 200) throw Invalid("Drawing instrument keys need 1 to 200 characters.");
            if (instrument.Value.ValueKind != JsonValueKind.Array || instrument.Value.GetArrayLength() > MaxDrawingsPerInstrument ||
                instrument.Value.EnumerateArray().Any(drawing => drawing.ValueKind != JsonValueKind.Object))
                throw Invalid($"Each instrument holds a list of at most {MaxDrawingsPerInstrument} drawings.");
        }
        var text = JsonSerializer.Serialize(value);
        return text.Length <= MaxDrawingsLength ? text : throw Invalid("Drawings are too large to save.");
    }

    public static JsonElement ReadDrawings(string stored) => JsonDocument.Parse(stored).RootElement.Clone();

    private static string Unit(string? unit) => unit is "price" or "percent" ? unit : throw Invalid("Level units are price or percent.");

    private static string Number(string? value) => value is not null && (value.Length == 0 || value.Length <= 64 && NumberPattern().IsMatch(value))
        ? value : throw Invalid("Plan numbers must be blank or decimal text.");

    private static string Note(string? note) => note is not null && note.Length <= MaxNoteLength
        ? note : throw Invalid($"Notes are limited to {MaxNoteLength} characters.");

    private static WorkspaceException Invalid(string detail) => new(400, detail);

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex IdPattern();
    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex ColorPattern();
    [GeneratedRegex(@"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")]
    private static partial Regex NumberPattern();
}

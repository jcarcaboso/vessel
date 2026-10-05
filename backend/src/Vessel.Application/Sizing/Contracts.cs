using System.Text.Json.Serialization;
using Vessel.Domain.Plays;
using Vessel.Domain.Sizing;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Sizing;

public sealed record UpdateSizingSettingsRequest([property: JsonRequired] string RiskPercent);

public sealed record SizingSettingsDto(string RiskPercent);

public sealed record ExposureDto(string Level, string Multiplier, string Reason, int LossStreak, int WinsSinceStepDown);

public sealed record PlayOutcomeDto(Guid PlayId, string Title, string? Instrument, DateTimeOffset ClosedAtUtc, string NetResultUsd,
    string ReturnPercent, string? RiskUsd, string? RMultiple, string Outcome, bool FeesComplete);

public sealed record TrackRecordDto(int ClosedPlays, int DecidedPlays, int Window, int Wins, int Losses, int Scratches,
    string? BattingAverage, string? AverageGainPercent, string? AverageLossPercent, string? WinLossRatio, string? BreakEvenRewardRisk,
    string? AverageWinR, string? AverageLossR, IReadOnlyList<PlayOutcomeDto> Recent);

public sealed record SizingLimitsDto(string EffectiveRiskPercent, string MaxStopPercent, string MinRewardRisk, string MaxStopSource,
    string MinRewardRiskSource);

public sealed record SizingDto(SizingSettingsDto Settings, ExposureDto Exposure, TrackRecordDto Record, SizingLimitsDto Limits, string Notice);

/// <summary>A closed Play with its plan revisions and the fills of its linked orders.</summary>
public sealed record ClosedPlayFacts(Play Play, IReadOnlyList<PlayPlanRevision> Revisions, IReadOnlyList<LinkedFill> Fills);

public sealed record LinkedFill(OrderLinkRole Role, ImportedFill Fill);

// Application owns this bounded port; EF details stay in Persistence. Reads are owner-filtered.
public interface ISizingStore
{
    Task<SizingSettings?> SettingsAsync(CancellationToken ct);
    /// <summary>Closed Plays on enabled accounts with their revisions and linked fills.</summary>
    Task<List<ClosedPlayFacts>> ClosedPlaysAsync(CancellationToken ct);
    void Add(SizingSettings settings);
    Task SaveAsync(CancellationToken ct);
}

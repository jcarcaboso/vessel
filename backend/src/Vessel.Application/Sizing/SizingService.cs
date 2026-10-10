using System.Globalization;
using Vessel.Application.Ownership;
using Vessel.Application.Plays;
using Vessel.Application.Workspace;
using Vessel.Domain.Sizing;

namespace Vessel.Application.Sizing;

/// <summary>
/// The owner's track record from closed Plays, the exposure level it implies and the limits the editor's
/// sizing suggestions use. Outcomes come only from linked venue fills; nothing is inferred from prices.
/// </summary>
public sealed class SizingService(ISizingStore store, IJournalOwnerContext owner, TimeProvider time)
{
    private const string Notice = "Results come from each closed play's linked fills: venue closed PnL less fees paid in USDC. " +
        "Suggestions are mechanical estimates from your risk setting and record, not advice.";

    public async Task<SizingDto> GetAsync(CancellationToken ct)
    {
        var settings = await store.SettingsAsync(ct);
        return ToDto(settings?.RiskPercent ?? SizingSettings.DefaultRiskPercent, await store.ClosedPlaysAsync(ct));
    }

    public async Task<SizingDto> UpdateSettingsAsync(UpdateSizingSettingsRequest request, CancellationToken ct)
    {
        if (request.RiskPercent is not { Length: > 0 and <= 16 } text ||
            !decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var risk))
            throw new WorkspaceException(400, "Risk per trade must be a decimal percentage.");
        var now = time.GetUtcNow();
        var settings = await store.SettingsAsync(ct);
        try
        {
            if (settings is null) store.Add(new SizingSettings(owner.OwnerId, risk, now));
            else settings.SetRisk(risk, now);
        }
        catch (ArgumentException ex) { throw new WorkspaceException(400, ex.Message); }
        await store.SaveAsync(ct);
        return ToDto(risk, await store.ClosedPlaysAsync(ct));
    }

    private static SizingDto ToDto(decimal risk, List<ClosedPlayFacts> closed)
    {
        var outcomes = closed.Select(facts => (facts.Play, Outcome: Outcome(facts))).Where(x => x.Outcome is not null)
            .Select(x => (x.Play, Outcome: x.Outcome!)).ToList();
        var record = TrackRecord.From(outcomes.Select(x => x.Outcome).ToList());
        var exposure = Exposure.From(outcomes.Select(x => x.Outcome));
        var limits = SizingLimits.From(risk, record, exposure);
        var recent = outcomes.OrderByDescending(x => x.Outcome.ClosedAtUtc).ThenBy(x => x.Play.Id).Take(record.Window)
            .Select(x => new PlayOutcomeDto(x.Play.Id, x.Play.Title, x.Play.ContractId, x.Outcome.ClosedAtUtc, Number(x.Outcome.NetResult),
                Number(x.Outcome.ReturnPercent), Number(x.Outcome.PlannedRisk), Number(x.Outcome.RMultiple), Name(x.Outcome.Kind),
                x.Outcome.FeesComplete))
            .ToList();
        return new SizingDto(new SizingSettingsDto(Number(risk)),
            new ExposureDto(Name(exposure.Level), Number(exposure.Multiplier), exposure.Reason, exposure.LossStreak, exposure.WinsSinceStepDown),
            new TrackRecordDto(record.ClosedPlays, record.DecidedPlays, record.Window, record.Wins, record.Losses, record.Scratches,
                Number(record.BattingAverage), Number(record.AverageGainPercent), Number(record.AverageLossPercent), Number(record.WinLossRatio),
                Number(record.BreakEvenRewardRisk), Number(record.AverageWinR), Number(record.AverageLossR), recent),
            new SizingLimitsDto(Number(limits.EffectiveRiskPercent), Number(limits.MaxStopPercent), Number(limits.MinRewardRisk),
                Source(limits.MaxStopSource), Source(limits.MinRewardRiskSource)),
            Notice);
    }

    // Kept for sizing callers; reporting and sizing share the same result arithmetic.
    public static PlayOutcome? Outcome(ClosedPlayFacts facts) => PlayOutcomeCalculator.Outcome(facts);
    public static decimal? StopDistance(PlayPlanDocument plan) => PlayOutcomeCalculator.StopDistance(plan);

    private static string Number(decimal value) => decimal.Round(value, 8).ToString("0.########", CultureInfo.InvariantCulture);
    private static string? Number(decimal? value) => value is { } number ? Number(number) : null;
    private static string Name<T>(T value) where T : Enum => value.ToString().ToLowerInvariant();

    private static string Source(LimitSource source) => source switch
    {
        LimitSource.AverageGain => "averageGain",
        LimitSource.BattingAverage => "battingAverage",
        _ => "default",
    };
}

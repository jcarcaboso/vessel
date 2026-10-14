using Vessel.Application.Workspace;
using Vessel.Application.Common;
using Vessel.Application.Ownership;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Domain.Numerics;
using Vessel.Domain.Sizing;
using Vessel.Domain.Plays;

namespace Vessel.Application.Sizing;

/// <summary>
/// The owner's track record from closed Plays, the exposure level it implies and the limits the editor's
/// sizing suggestions use. Outcomes come only from linked venue fills; nothing is inferred from prices.
/// </summary>
public sealed class SizingService(ISizingStore store, IJournalOwnerContext owner, TimeProvider time)
{
    private const string Notice = "Results come from each closed play's linked fills: venue closed PnL less fees paid in listed USD stablecoins. " +
        NominalStablecoins.Caveat + " Plays on venues with different quote stablecoins are pooled nominally. " +
        "Suggestions are mechanical estimates from your risk setting and record, not advice.";

    public async Task<SizingDto> GetAsync(CancellationToken ct)
    {
        var settings = await store.SettingsAsync(ct);
        return ToDto(settings?.RiskPercent ?? SizingSettings.DefaultRiskPercent, await store.ClosedPlaysAsync(ct));
    }

    public async Task<SizingDto> UpdateSettingsAsync(UpdateSizingSettingsRequest request, CancellationToken ct)
    {
        if (!ExactDecimal.TryParseRiskPercent(request.RiskPercent, out var risk))
            throw new ProblemException(400, "Risk per trade must be a decimal percentage.");
        var now = time.GetUtcNow();
        var settings = await store.SettingsAsync(ct);
        if (settings is null) store.Add(new SizingSettings(owner.OwnerId, risk, now));
        else settings.SetRisk(risk, now);
        await store.SaveAsync(ct);
        return ToDto(risk, await store.ClosedPlaysAsync(ct));
    }

    private static SizingDto ToDto(decimal risk, List<ClosedPlayFacts> closed)
    {
        // A closed record whose linked fills are known incomplete, contradictory or out of order is not a decided outcome.
        var outcomes = closed.Where(f => f.Play.Origin != PlayOrigin.Retrospective && f.ManualFeesComplete)
            .Where(ExecutionIntegrity.Settled).Select(facts => (facts.Play, Outcome: PlayOutcomeCalculator.Outcome(facts))).Where(x => x.Outcome is not null)
            .Select(x => (x.Play, Outcome: x.Outcome!)).ToList();
        var record = TrackRecord.From(outcomes.Select(x => x.Outcome).ToList());
        var exposure = Exposure.From(outcomes.Select(x => x.Outcome));
        var limits = SizingLimits.From(risk, record, exposure);
        var recent = outcomes.OrderByDescending(x => x.Outcome.ClosedAtUtc).ThenBy(x => x.Play.Id).Take(record.Window)
            .Select(x => new PlayOutcomeDto(x.Play.Id, x.Play.Title, x.Play.ContractId, x.Outcome.ClosedAtUtc,
                ExactDecimal.FormatEightPlaces(x.Outcome.NetResult), ExactDecimal.FormatEightPlaces(x.Outcome.ReturnPercent),
                ExactDecimal.FormatEightPlaces(x.Outcome.PlannedRisk), ExactDecimal.FormatEightPlaces(x.Outcome.RMultiple), Name(x.Outcome.Kind),
                x.Outcome.FeesComplete))
            .ToList();
        return new SizingDto(new SizingSettingsDto(ExactDecimal.FormatEightPlaces(risk)),
            new ExposureDto(Name(exposure.Level), ExactDecimal.FormatEightPlaces(exposure.Multiplier), exposure.Reason, exposure.LossStreak,
                exposure.WinsSinceStepDown),
            new TrackRecordDto(record.ClosedPlays, record.DecidedPlays, record.Window, record.Wins, record.Losses, record.Scratches,
                ExactDecimal.FormatEightPlaces(record.BattingAverage), ExactDecimal.FormatEightPlaces(record.AverageGainPercent),
                ExactDecimal.FormatEightPlaces(record.AverageLossPercent), ExactDecimal.FormatEightPlaces(record.WinLossRatio),
                ExactDecimal.FormatEightPlaces(record.BreakEvenRewardRisk), ExactDecimal.FormatEightPlaces(record.AverageWinR),
                ExactDecimal.FormatEightPlaces(record.AverageLossR), recent),
            new SizingLimitsDto(ExactDecimal.FormatEightPlaces(limits.EffectiveRiskPercent), ExactDecimal.FormatEightPlaces(limits.MaxStopPercent),
                ExactDecimal.FormatEightPlaces(limits.MinRewardRisk), Source(limits.MaxStopSource), Source(limits.MinRewardRiskSource)),
            Notice);
    }

    private static string Name<T>(T value) where T : Enum => value.ToString().ToLowerInvariant();

    private static string Source(LimitSource source) => source switch
    {
        LimitSource.AverageGain => "averageGain",
        LimitSource.BattingAverage => "battingAverage",
        _ => "default",
    };
}

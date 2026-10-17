using System.Globalization;
using System.Text.Json;
using Vessel.Application.Plays;
using Vessel.Application.Sizing;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Tests;

/// <summary>Plans parsed once per stored document give the same answers as parsing every time.</summary>
public sealed class ClosedPlayPlanParsingTests
{
    private static readonly DateTimeOffset Planned = DateTimeOffset.Parse("2026-10-01T10:00:00Z", CultureInfo.InvariantCulture);
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static PlayPlanDocument Plan(string stop, string direction = "long") => new(direction, "margin", "250", "3", null,
        [new PlanEntry("entry-1", "entry-1", "#b9c9e4", "100", "100", [new PlanExit("stop-1", "price", stop, "100")],
            [new PlanExit("t", "price", direction == "long" ? "120" : "80", "100")])], new PlanNotes("", "", "", ""));

    private static ImportedFill Fill(string side, decimal price, decimal pnl, int minutes) => new()
    {
        Id = Guid.NewGuid(), Price = price, Quantity = 2, ClosedPnlUsd = pnl, Fee = 0.1m, FeeToken = "USDC", PnlBasis = ExecutionFacts.PnlGross,
        OccurredAtUtc = Planned.AddMinutes(minutes), ExternalOrderId = "o" + minutes, ContractId = "BTC", SourceFillId = "f" + minutes, Side = side,
        PositionEffect = ExecutionFacts.Unknown, Direction = "", TransactionHash = "",
    };

    /// <summary>Revision 1 stops at 95; revision 2, two hours after planning, at 90; the current plan then moves to 85.</summary>
    private static ClosedPlayFacts Facts(int entryMinutes, bool retrospective = false)
    {
        var account = new Account(Guid.NewGuid(), Guid.NewGuid(), "hyperliquid", "Venue");
        var play = new Play(Guid.NewGuid(), account, new PerpetualInstrument("hyperliquid", "BTC"), InstrumentSource.Venue,
            PlayDocuments.Serialize(Plan("95")), Planned);
        List<PlayPlanRevision> revisions = [play.MarkPlanned(Planned).Revision];
        revisions.Add(play.ChangePlan(PlayDocuments.Serialize(Plan("90")), "Moved stop", Planned.AddHours(2))!);
        play.MarkOpen("Filled.", Planned.AddHours(3));
        play.ChangePlan(PlayDocuments.Serialize(Plan("85")), "Trailed", Planned.AddHours(4));
        play.MarkClosed("Exited.", Planned.AddDays(1));
        if (retrospective) typeof(Play).GetProperty(nameof(Play.Origin))!.SetValue(play, PlayOrigin.Retrospective);
        return new ClosedPlayFacts(play, revisions,
            [new(OrderLinkRole.Entry, Fill(ExecutionFacts.Buy, 100, 0, entryMinutes)), new(OrderLinkRole.Target, Fill(ExecutionFacts.Sell, 110, 20, entryMinutes + 600))]);
    }

    private static string Json(object? value) => JsonSerializer.Serialize(value, Web);

    [Theory]
    [InlineData(30, "10")]     // before revision 2: stop 95, risk 200 x 5%
    [InlineData(119, "10")]
    [InlineData(120, "20")]    // exactly at revision 2: stop 90
    [InlineData(300, "20")]    // after the current plan's later change, revision 2 is still the latest stored revision at entry
    public void Initial_risk_uses_the_revision_at_the_first_entry_not_the_current_plan(int entryMinutes, string risk)
    {
        var facts = Facts(entryMinutes);
        Assert.Equal(Json(PlayDocuments.Read(facts.Play.Plan)), Json(facts.CurrentPlan));
        Assert.Equal("85", facts.CurrentPlan.Entries[0].Stops[0].Value);
        var outcome = PlayOutcomeCalculator.Outcome(facts)!;
        Assert.Equal(decimal.Parse(risk, CultureInfo.InvariantCulture), outcome.PlannedRisk);
        // The current plan is still answered correctly after a revision was parsed through the same facts.
        Assert.Equal("85", facts.CurrentPlan.Entries[0].Stops[0].Value);
        Assert.Same(facts.CurrentPlan, facts.CurrentPlan);
        Assert.Equal("95", facts.ParsedPlan(facts.Revisions[0].Plan).Entries[0].Stops[0].Value);
        Assert.Equal("90", facts.ParsedPlan(facts.Revisions[1].Plan).Entries[0].Stops[0].Value);
    }

    [Fact]
    public void Retrospective_records_have_no_initial_risk()
    {
        var outcome = PlayOutcomeCalculator.Outcome(Facts(30, retrospective: true))!;
        Assert.Null(outcome.PlannedRisk);
        Assert.Equal(19.8m, outcome.NetResult);
    }

    [Fact]
    public void Repeated_outcomes_are_identical()
    {
        var facts = Facts(30);
        var first = PlayOutcomeCalculator.Outcome(facts);
        Assert.Equal(first, PlayOutcomeCalculator.Outcome(facts));
        Assert.Equal(first, PlayOutcomeCalculator.Outcome(facts with { }));
    }

    [Fact]
    public void The_parsed_plan_cache_takes_no_part_in_equality_and_never_answers_for_another_play()
    {
        var facts = Facts(30);
        var twin = new ClosedPlayFacts(facts.Play, facts.Revisions, facts.Fills);
        _ = facts.CurrentPlan;
        Assert.Equal(twin, facts);
        Assert.Equal(twin.GetHashCode(), facts.GetHashCode());

        var other = new Play(Guid.NewGuid(), new Account(Guid.NewGuid(), Guid.NewGuid(), "hyperliquid", "Venue"),
            new PerpetualInstrument("hyperliquid", "BTC"), InstrumentSource.Venue, PlayDocuments.Serialize(Plan("105", "short")), Planned);
        var copy = facts with { Play = other };
        Assert.Equal(("short", "105"), (copy.CurrentPlan.Direction, copy.CurrentPlan.Entries[0].Stops[0].Value));
        Assert.Equal("long", facts.CurrentPlan.Direction);
    }

    [Fact]
    public void Play_dto_parses_once_and_serializes_exactly_as_before()
    {
        var play = Facts(30).Play;
        var dto = PlayService.ToDto(play);
        var previous = new PlayDto(PlayService.Summary(play), PlayDocuments.Read(play.Plan), PlayDocuments.ReadDrawings(play.Drawings),
            play.Review, play.Answers);
        Assert.Equal(Json(previous), Json(dto));
        Assert.Equal("long", dto.Summary.Direction);
    }
}

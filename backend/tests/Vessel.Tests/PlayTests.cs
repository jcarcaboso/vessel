using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Npgsql;
using Vessel.Application.Plays;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Evidence;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;

namespace Vessel.Tests;

internal static class TestPlays
{
    public static PlayPlanDocument Plan(string price = "100", string stop = "95") => new("long", "margin", "250", "3", null,
        [new PlanEntry("entry-1", "Entry 1", "#b9c9e4", "100", price, [new PlanExit("stop-1", "price", stop, "100")],
            [new PlanExit("target-1", "price", "110", "100")])],
        new PlanNotes("Breakout retest", "Close below 94", "", ""));

    public static Play Create(Account account, PerpetualInstrument? instrument) => new(Guid.NewGuid(), account, instrument,
        account.VenueId == "manual" ? InstrumentSource.Manual : InstrumentSource.Venue, PlayDocuments.Serialize(Plan()), DateTimeOffset.UnixEpoch);
}

internal sealed class MemoryPlayStore(Guid owner) : IPlayStore
{
    public List<Account> Accounts { get; } = [];
    public List<Play> Plays { get; } = [];
    public List<PlayPlanRevision> Revisions { get; } = [];
    public List<PlayStatusChange> Changes { get; } = [];
    public List<string> EvidenceKeys { get; } = [];
    public int Saves { get; private set; }
    public Task<List<Play>> ListAsync(CancellationToken ct) => Task.FromResult(Plays.Where(p => p.OwnerId == owner).ToList());
    public Task<Play?> FindAsync(Guid id, CancellationToken ct) => Task.FromResult(Plays.SingleOrDefault(p => p.Id == id && p.OwnerId == owner));
    public Task<Account?> AccountAsync(Guid id, CancellationToken ct) => Task.FromResult(Accounts.SingleOrDefault(a => a.Id == id && a.OwnerId == owner));
    public Task<List<PlayPlanRevision>> RevisionsAsync(Guid playId, CancellationToken ct) => Task.FromResult(Revisions.Where(r => r.PlayId == playId).ToList());
    public Task<List<PlayStatusChange>> StatusChangesAsync(Guid playId, CancellationToken ct) => Task.FromResult(Changes.Where(c => c.PlayId == playId).ToList());
    public void Add(Play play) => Plays.Add(play);
    public void Add(PlayPlanRevision revision) => Revisions.Add(revision);
    public void Add(PlayStatusChange change) => Changes.Add(change);
    public HashSet<string> FilledEntries { get; } = [];
    public Task<IReadOnlySet<string>> FilledEntryIdsAsync(Guid playId, CancellationToken ct) => Task.FromResult<IReadOnlySet<string>>(FilledEntries);
    public Task SaveAsync(CancellationToken ct) { Saves++; return Task.CompletedTask; }
    public Task<IReadOnlyList<string>> DeleteAsync(Play play, CancellationToken ct)
    {
        Plays.Remove(play);
        return Task.FromResult<IReadOnlyList<string>>(EvidenceKeys);
    }
}

public sealed class PlayDomainTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-03T10:00:00Z");
    private readonly Account account = new(Guid.NewGuid(), Guid.NewGuid(), "hyperliquid", "Trading");

    [Fact]
    public void Draft_edits_create_no_revisions_and_planning_records_the_first()
    {
        var play = TestPlays.Create(account, new PerpetualInstrument("hyperliquid", "BTC"));
        Assert.Null(play.ChangePlan(PlayDocuments.Serialize(TestPlays.Plan("101")), null, Now));
        Assert.Equal(0, play.PlanRevision);
        var (change, revision) = play.MarkPlanned(Now);
        Assert.Equal((PlayStatus.Draft, PlayStatus.Planned), (change.From, change.To));
        Assert.Equal((1, "Planned", PlayStatus.Planned), (revision.Number, revision.Reason, revision.Status));
        Assert.Contains("\"price\":\"101\"", revision.Plan);
        Assert.Equal(Now, play.PlannedAtUtc);
    }

    [Fact]
    public void Planned_plan_changes_need_a_reason_and_append_revisions()
    {
        var play = TestPlays.Create(account, new PerpetualInstrument("hyperliquid", "BTC"));
        play.MarkPlanned(Now);
        var moved = PlayDocuments.Serialize(TestPlays.Plan(stop: "97"));
        Assert.Throws<PlayRuleException>(() => play.ChangePlan(moved, " ", Now));
        var revision = play.ChangePlan(moved, "  Tightened the stop under the new low ", Now)!;
        Assert.Equal((2, "Tightened the stop under the new low"), (revision.Number, revision.Reason));
        Assert.Null(play.ChangePlan(moved, null, Now));
        play.Annotate("Renamed", "{}", "", Now);
        Assert.Equal(2, play.PlanRevision);
    }

    [Fact]
    public void Account_and_instrument_are_fixed_after_planning()
    {
        var play = TestPlays.Create(account, null);
        Assert.Throws<PlayRuleException>(() => play.MarkPlanned(Now));
        play.MoveTo(account, new PerpetualInstrument("hyperliquid", "ETH"), InstrumentSource.Venue, Now);
        play.MarkPlanned(Now);
        Assert.Throws<PlayRuleException>(() => play.MoveTo(account, new PerpetualInstrument("hyperliquid", "BTC"), InstrumentSource.Venue, Now));
        Assert.Throws<ArgumentException>(() => TestPlays.Create(account, new PerpetualInstrument("manual", "BTC")));
    }

    [Fact]
    public void Pause_resume_and_cancel_follow_the_lifecycle()
    {
        var play = TestPlays.Create(account, new PerpetualInstrument("hyperliquid", "BTC"));
        Assert.Throws<PlayRuleException>(() => play.Pause(Now));
        play.MarkPlanned(Now);
        play.Pause(Now);
        Assert.Throws<PlayRuleException>(() => play.MarkPlanned(Now));
        Assert.Equal(PlayStatus.Planned, play.Resume(Now).To);
        var cancelled = play.Cancel(CancelReason.Missed, " Price ran away ", Now);
        Assert.Equal((PlayStatus.Cancelled, CancelReason.Missed, "Price ran away"), (play.Status, cancelled.Reason, cancelled.Note));
        Assert.Equal(Now, play.EndedAtUtc);
        Assert.Throws<PlayRuleException>(() => play.Resume(Now));
        Assert.Throws<PlayRuleException>(() => play.ChangePlan(PlayDocuments.Serialize(TestPlays.Plan("1")), "late", Now));
        Assert.Throws<PlayRuleException>(() => play.Annotate("New title", "{}", "", Now));
        play.Annotate(play.Title, play.Drawings, "Should have waited for the retest.", Now);
        Assert.Equal("Should have waited for the retest.", play.Review);
    }

    [Fact]
    public void Every_change_moves_the_version()
    {
        var play = TestPlays.Create(account, new PerpetualInstrument("hyperliquid", "BTC"));
        var versions = new List<long> { play.Version };
        play.Annotate("Title", "{}", "", Now); versions.Add(play.Version);
        play.Annotate("Title", "{}", "", Now); versions.Add(play.Version);
        play.MarkPlanned(Now); versions.Add(play.Version);
        Assert.Equal([1, 2, 2, 3], versions);
    }
}

public sealed class PlayDocumentTests
{
    [Fact]
    public void Plans_keep_exact_numbers_and_reject_malformed_input()
    {
        var plan = PlayDocuments.Normalize(TestPlays.Plan("0.000012340"));
        Assert.Equal("0.000012340", plan.Entries[0].Price);
        Assert.Equal(PlayDocuments.Serialize(plan), PlayDocuments.Serialize(PlayDocuments.Read(PlayDocuments.Serialize(plan))));
        Assert.Equal("", PlayDocuments.Normalize(TestPlays.Plan("")).Entries[0].Price);
        foreach (var invalid in new[]
        {
            TestPlays.Plan("12abc"), TestPlays.Plan() with { Leverage = "2.5" }, TestPlays.Plan() with { Leverage = "101" },
            TestPlays.Plan() with { Direction = "up" }, TestPlays.Plan() with { Entries = [] },
            TestPlays.Plan() with { Entries = [TestPlays.Plan().Entries[0], TestPlays.Plan().Entries[0]] },
            TestPlays.Plan() with { Entries = [TestPlays.Plan().Entries[0] with { Stops = [new PlanExit("stop-1", "pips", "1", "100")] }] },
            TestPlays.Plan() with { Notes = new PlanNotes(new string('x', 20001), "", "", "") },
            TestPlays.Plan() with { Entries = [TestPlays.Plan().Entries[0] with { Stops = Enumerable.Range(0, 11).Select(i => new PlanExit($"s{i}", "price", "90", "")).ToList() }] },
            // Stop and target IDs share one namespace with entries.
            TestPlays.Plan() with { Entries = [TestPlays.Plan().Entries[0] with { Stops = [new PlanExit("target-1", "price", "90", "100")] }] },
        })
            Assert.Equal(400, Assert.Throws<WorkspaceException>(() => PlayDocuments.Normalize(invalid)).StatusCode);
    }

    [Fact]
    public void Planning_requires_a_priced_entry()
    {
        Assert.Equal(409, Assert.Throws<WorkspaceException>(() => PlayDocuments.RequirePlannable(TestPlays.Plan(""))).StatusCode);
        PlayDocuments.RequirePlannable(TestPlays.Plan("1e-5"));
    }

    [Fact]
    public void Drawings_are_bounded_objects_of_lists()
    {
        Assert.Equal("{}", PlayDocuments.NormalizeDrawings(null));
        Assert.Equal("""{"hyperliquid:BTC":[{"id":"a"}]}""",
            PlayDocuments.NormalizeDrawings(JsonDocument.Parse("""{ "hyperliquid:BTC": [ { "id": "a" } ] }""").RootElement));
        foreach (var invalid in new[] { "[]", """{"a":{}}""", """{"a":[1]}""", """{"":[]}""" })
            Assert.Throws<WorkspaceException>(() => PlayDocuments.NormalizeDrawings(JsonDocument.Parse(invalid).RootElement));
        var many = "{\"a\":[" + string.Join(',', Enumerable.Repeat("{}", 201)) + "]}";
        Assert.Throws<WorkspaceException>(() => PlayDocuments.NormalizeDrawings(JsonDocument.Parse(many).RootElement));
    }
}

public sealed class PlayServiceTests
{
    private readonly Guid owner = Guid.NewGuid();
    private readonly MemoryPlayStore store;
    private readonly MemoryObjectStore objects = new();
    private readonly PlayService service;
    private readonly Account venue;
    private readonly Account manual;

    public PlayServiceTests()
    {
        store = new MemoryPlayStore(owner);
        venue = new Account(Guid.NewGuid(), owner, "hyperliquid", "Venue");
        manual = new Account(Guid.NewGuid(), owner, "manual", "Manual");
        store.Accounts.AddRange(venue, manual);
        service = new PlayService(store, objects, TimeProvider.System);
    }

    private Task<PlayDto> Create(Account? account = null, string? instrument = "BTC", string source = "venue", PlayPlanDocument? plan = null) =>
        service.CreateAsync(new CreatePlayRequest((account ?? venue).Id, instrument, source, " Breakout ", plan ?? TestPlays.Plan()), default);

    private UpdatePlayRequest Update(PlayDto play, PlayPlanDocument? plan = null, string? reason = null, string? instrument = null) =>
        new(play.Summary.Version, play.Summary.AccountId, instrument ?? play.Summary.Instrument, play.Summary.InstrumentSource,
            play.Summary.Title, plan ?? play.Plan, play.Drawings, play.Review, reason);

    [Fact]
    public async Task Creates_a_draft_with_exact_plan_text()
    {
        var play = await Create(plan: TestPlays.Plan("0.00001230"));
        Assert.Equal(("draft", "Breakout", "BTC", "venue", "long", 0), (play.Summary.Status, play.Summary.Title,
            play.Summary.Instrument, play.Summary.InstrumentSource, play.Summary.Direction, play.Summary.PlanRevision));
        Assert.Equal("0.00001230", play.Plan.Entries[0].Price);
        Assert.Equal(JsonValueKind.Object, play.Drawings.ValueKind);
        Assert.Single(await service.ListAsync(default));
    }

    [Fact]
    public async Task Validates_accounts_and_instruments()
    {
        Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => Create(new Account(Guid.NewGuid(), Guid.NewGuid(), "manual", "Foreign")))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => Create(manual, "BTC", "venue"))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => Create(instrument: "dex:BTC"))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => Create(manual, " BTC", "manual"))).StatusCode);
        Assert.Equal("BTC-PERP", (await Create(manual, "BTC-PERP", "manual")).Summary.Instrument);
        Assert.Equal("manual", (await Create(venue, "Some label", "manual")).Summary.InstrumentSource);
        Assert.Null((await Create(instrument: null)).Summary.Instrument);
        venue.UpdateSettings(venue.Name, null, false);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() => Create())).StatusCode);
    }

    [Fact]
    public async Task Planning_then_revising_keeps_the_history()
    {
        var play = await Create(plan: TestPlays.Plan(""));
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() =>
            service.ChangeStatusAsync(play.Summary.Id, new(play.Summary.Version, "planned"), default))).StatusCode);
        play = await service.UpdateAsync(play.Summary.Id, Update(play, TestPlays.Plan("100")), default);
        Assert.Empty(store.Revisions);
        play = await service.ChangeStatusAsync(play.Summary.Id, new(play.Summary.Version, "planned"), default);
        Assert.Equal(("planned", 1), (play.Summary.Status, play.Summary.PlanRevision));

        var moved = TestPlays.Plan(stop: "97");
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() =>
            service.UpdateAsync(play.Summary.Id, Update(play, moved), default))).StatusCode);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() =>
            service.UpdateAsync(play.Summary.Id, Update(play, instrument: "ETH"), default))).StatusCode);
        play = await service.UpdateAsync(play.Summary.Id, Update(play, moved, "Stop under the new swing low"), default);
        Assert.Equal(2, play.Summary.PlanRevision);

        var history = await service.HistoryAsync(play.Summary.Id, default);
        Assert.Equal(["Planned", "Stop under the new swing low"], history.Revisions.Select(r => r.Reason));
        Assert.Equal(["95", "97"], history.Revisions.Select(r => r.Plan.Entries[0].Stops[0].Value));
        Assert.Equal(("draft", "planned"), (history.StatusChanges.Single().From, history.StatusChanges.Single().To));
    }

    [Fact]
    public async Task Stale_versions_and_invalid_transitions_conflict()
    {
        var play = await Create();
        var stale = play.Summary.Version;
        play = await service.UpdateAsync(play.Summary.Id, Update(play) with { Title = "Renamed" }, default);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() =>
            service.UpdateAsync(play.Summary.Id, Update(play) with { ExpectedVersion = stale }, default))).StatusCode);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() =>
            service.ChangeStatusAsync(play.Summary.Id, new(play.Summary.Version, "paused"), default))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() =>
            service.ChangeStatusAsync(play.Summary.Id, new(play.Summary.Version, "open"), default))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() =>
            service.ChangeStatusAsync(play.Summary.Id, new(play.Summary.Version, "cancelled", "bored"), default))).StatusCode);
        play = await service.ChangeStatusAsync(play.Summary.Id, new(play.Summary.Version, "cancelled", "changed-mind", "Not my setup"), default);
        Assert.Equal(("cancelled", "changed-mind"), (play.Summary.Status, play.Summary.CancelReason));
        var history = await service.HistoryAsync(play.Summary.Id, default);
        Assert.Equal(("changed-mind", "Not my setup"), (history.StatusChanges.Single().Reason, history.StatusChanges.Single().Note));
    }

    [Fact]
    public async Task Only_drafts_are_deleted_with_their_evidence_objects()
    {
        var draft = await Create();
        await objects.PutAsync("owner/play/a.png", new MemoryStream([1]), default);
        store.EvidenceKeys.Add("owner/play/a.png");
        await service.DeleteAsync(draft.Summary.Id, default);
        Assert.Empty(objects.Objects);
        Assert.Empty(await service.ListAsync(default));

        var planned = await Create();
        planned = await service.ChangeStatusAsync(planned.Summary.Id, new(planned.Summary.Version, "planned"), default);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() => service.DeleteAsync(planned.Summary.Id, default))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.GetAsync(Guid.NewGuid(), default))).StatusCode);
    }
}

public sealed class PlayPostgresTests
{
    private static object Body(Guid accountId, string title = "Breakout", string price = "100") => new
    {
        accountId, instrument = "BTC", instrumentSource = "venue", title, plan = TestPlays.Plan(price),
        drawings = new Dictionary<string, object[]> { ["hyperliquid:BTC"] = [new { id = "d1", kind = "text" }] },
    };

    [PostgresFact]
    public async Task Saved_plays_round_trip_with_revisions_history_and_concurrency()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var account = new Account(Guid.NewGuid(), owner, "hyperliquid", "Account");
        await using (var db = database.Context(owner)) { db.Accounts.Add(account); await db.SaveChangesAsync(); }
        await using var factory = new CoreApiFactory(owner, connection: database.ConnectionString);
        using var client = factory.AuthorizedClient();

        var created = await client.PostAsJsonAsync("/api/plays", Body(account.Id));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var play = (await created.Content.ReadFromJsonAsync<PlayDto>())!;
        Assert.Equal("d1", play.Drawings.GetProperty("hyperliquid:BTC")[0].GetProperty("id").GetString());

        var planned = await client.PostAsJsonAsync($"/api/plays/{play.Summary.Id}/status", new { expectedVersion = play.Summary.Version, status = "planned" });
        play = (await planned.Content.ReadFromJsonAsync<PlayDto>())!;
        var update = new UpdatePlayRequest(play.Summary.Version, account.Id, "BTC", "venue", "Breakout", TestPlays.Plan(stop: "97"), play.Drawings, "", "Moved stop");
        var revised = await client.PutAsJsonAsync($"/api/plays/{play.Summary.Id}", update);
        Assert.Equal(HttpStatusCode.OK, revised.StatusCode);
        // The same expected version again is stale.
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/plays/{play.Summary.Id}", update)).StatusCode);

        var history = (await client.GetFromJsonAsync<PlayHistoryDto>($"/api/plays/{play.Summary.Id}/history"))!;
        Assert.Equal([1, 2], history.Revisions.Select(r => r.Number));
        Assert.Equal("97", history.Revisions[1].Plan.Entries[0].Stops[0].Value);
        Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/plays/{play.Summary.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/accounts/{account.Id}")).StatusCode);

        // Another owner sees nothing and cannot read the history.
        await using var foreign = new CoreApiFactory(Guid.NewGuid(), connection: database.ConnectionString);
        using var other = foreign.AuthorizedClient();
        Assert.Equal("[]", await other.GetStringAsync("/api/plays"));
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/plays/{play.Summary.Id}/history")).StatusCode);

        await using var db2 = database.Context(owner);
        Assert.Equal("97", await db2.Database.SqlQueryRaw<string>(
            "SELECT \"Plan\"->'entries'->0->'stops'->0->>'value' AS \"Value\" FROM plays").SingleAsync());
    }

    [PostgresFact]
    public async Task Deleting_a_draft_removes_its_evidence()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var account = new Account(Guid.NewGuid(), owner, "hyperliquid", "Account");
        var play = TestPlays.Create(account, new PerpetualInstrument("hyperliquid", "BTC"));
        await using (var db = database.Context(owner))
        {
            db.Accounts.Add(account);
            db.Plays.Add(play);
            db.Evidence.Add(new PlayEvidence(Guid.NewGuid(), play, "k/a.png", "image/png", 1, new string('a', 64), EvidenceSource.Upload, "", DateTimeOffset.UnixEpoch));
            await db.SaveChangesAsync();
        }
        await using (var db = database.Context(owner))
        {
            var store = new Vessel.Persistence.PlayStore(db);
            Assert.Equal(["k/a.png"], await store.DeleteAsync((await store.FindAsync(play.Id, default))!, default));
        }
        await using (var db = database.Context(owner))
        {
            Assert.Empty(await db.Plays.ToListAsync());
            Assert.Empty(await db.Evidence.ToListAsync());
            db.Accounts.Remove(await db.Accounts.SingleAsync());
            await db.SaveChangesAsync();
        }
    }

    [PostgresFact]
    public async Task Migration_keeps_earlier_play_heads_as_planned()
    {
        await using var database = await CoreDatabase.CreateAsync("EvidenceMarkup");
        var owner = Guid.NewGuid();
        await using (var connection = new NpgsqlConnection(database.ConnectionString))
        {
            await connection.OpenAsync();
            var account = Guid.NewGuid();
            await using var insert = new NpgsqlCommand($"""
                INSERT INTO accounts ("Id", "OwnerId", "VenueId", "Name", "SyncStatus") VALUES ('{account}', '{owner}', 'manual', 'A', 'manual');
                INSERT INTO plays ("Id", "OwnerId", "AccountId", "VenueId", "ContractId", "Status") VALUES ('{Guid.NewGuid()}', '{owner}', '{account}', 'manual', 'BTC', 'Active');
                """, connection);
            await insert.ExecuteNonQueryAsync();
        }
        await using (var db = database.Context(owner))
            await db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>().MigrateAsync();
        await using (var db = database.Context(owner))
        {
            var play = await db.Plays.SingleAsync();
            Assert.Equal((PlayStatus.Planned, InstrumentSource.Manual, 1L, "{}"), (play.Status, play.InstrumentSource, play.Version, play.Drawings));
            Assert.Equal("1", PlayDocuments.Read(play.Plan).Leverage);
        }
    }
}

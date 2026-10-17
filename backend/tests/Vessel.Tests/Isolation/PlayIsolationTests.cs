using System.Net;
using System.Text.Json;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;

namespace Vessel.Tests.Isolation;

/// <summary>Plays, revisions, status, history, order links and the manual diary across two owners.</summary>
public sealed class PlayIsolationTests(IsolationApi api) : IClassFixture<IsolationApi>
{
    private static readonly JsonElement NoDrawings = JsonDocument.Parse("{}").RootElement.Clone();

    private static async Task<JsonElement> Draft(Owner owner, Guid account, string title, string source = "venue") =>
        await owner.Post("/api/plays", new CreatePlayRequest(account, "BTC", source, title, TestPlays.Plan()), HttpStatusCode.Created);

    private static async Task<JsonElement> Planned(Owner owner, Guid account, string title, string source = "venue")
    {
        var draft = await Draft(owner, account, title, source);
        return await owner.Post($"/api/plays/{Id(draft)}/status", new ChangePlayStatusRequest(Version(draft), "planned"));
    }

    private static Guid Id(JsonElement play) => play.GetProperty("summary").GetProperty("id").GetGuid();
    private static long Version(JsonElement play) => play.GetProperty("summary").GetProperty("version").GetInt64();

    private static UpdatePlayRequest Update(JsonElement play, Guid account, string title, string source = "venue") =>
        new(Version(play), account, "BTC", source, title, TestPlays.Plan(price: "101"), NoDrawings, "", "Moved entry");

    [PostgresFact]
    [Covers("GET", "/api/plays/{id:guid}")]
    [Covers("POST", "/api/plays")]
    [Covers("PUT", "/api/plays/{id:guid}")]
    [Covers("POST", "/api/plays/{id:guid}/status")]
    [Covers("GET", "/api/plays/{id:guid}/history")]
    [Covers("DELETE", "/api/plays/{id:guid}")]
    public async Task Plays_of_another_owner_answer_like_unknown_ones_and_stay_unchanged()
    {
        var (a, b) = api.Owners();
        var aAccount = (await a.SyncedVenueAccount(Isolated.Marker("venue-a"))).GetProperty("id").GetGuid();
        var title = Isolated.Marker("play-a");
        var planned = await Planned(a, aAccount, title);
        var play = Id(planned);
        // Positive control: a revision with a reason, then history and detail reads.
        var revised = await a.Send(HttpMethod.Put, $"/api/plays/{play}", Update(planned, aAccount, title));
        Assert.Equal(2, revised.GetProperty("summary").GetProperty("planRevision").GetInt32());
        Assert.Equal(2, (await a.GetJson($"/api/plays/{play}/history")).GetProperty("revisions").GetArrayLength());
        var draft = Id(await Draft(a, aAccount, Isolated.Marker("draft-a")));
        var paths = new[] { $"/api/plays/{play}", $"/api/plays/{play}/history", $"/api/plays/{draft}", "/api/plays?view=all", "/api/plays/counts" };
        var before = await Isolated.State(a, paths);

        var bAccount = (await b.ManualAccount(Isolated.Marker("manual-b"))).GetProperty("id").GetGuid();
        var own = await Draft(b, bAccount, Isolated.Marker("draft-b"), "manual");
        foreach (var target in new[] { play, draft })
        {
            await Isolated.NotFound(b, target, Isolated.Request(HttpMethod.Get, id => $"/api/plays/{id}"));
            await Isolated.NotFound(b, target, Isolated.Request(HttpMethod.Get, id => $"/api/plays/{id}/history"));
            await Isolated.NotFound(b, target, Isolated.Request(HttpMethod.Put, id => $"/api/plays/{id}",
                _ => new UpdatePlayRequest(Version(revised), bAccount, "BTC", "manual", "taken-by-b", TestPlays.Plan(), NoDrawings, "", "Taken")));
            foreach (var status in new[] { "planned", "paused", "cancelled" })
                await Isolated.NotFound(b, target, Isolated.Request(HttpMethod.Post, id => $"/api/plays/{id}/status",
                    _ => new ChangePlayStatusRequest(Version(revised), status, status == "cancelled" ? "missed" : null)));
            await Isolated.NotFound(b, target, Isolated.Request(HttpMethod.Delete, id => $"/api/plays/{id}"));
        }
        Assert.Equal(before, await Isolated.State(a, paths));

        // A foreign account in a create or update body answers like an unknown account and stores nothing.
        var bPaths = new[] { "/api/plays?view=all", "/api/plays/counts", $"/api/plays/{Id(own)}" };
        var bBefore = await Isolated.State(b, bPaths);
        await Isolated.SameAsUnknown(b, aAccount, Isolated.Request(HttpMethod.Post, _ => "/api/plays",
            id => new CreatePlayRequest(id, "BTC", "venue", "into-foreign-account", TestPlays.Plan())));
        await Isolated.SameAsUnknown(b, aAccount, Isolated.Request(HttpMethod.Put, _ => $"/api/plays/{Id(own)}",
            id => Update(own, id, "moved-to-foreign-account")));
        Assert.Equal(bBefore, await Isolated.State(b, bPaths));
        Assert.Equal(before, await Isolated.State(a, paths));
        // A can still change its own Plays with the versions it held: nothing consumed them.
        await a.Post($"/api/plays/{play}/status", new ChangePlayStatusRequest(Version(revised), "paused"));
        await a.Send(HttpMethod.Delete, $"/api/plays/{draft}", expected: HttpStatusCode.NoContent);
    }

    [PostgresFact]
    [Covers("GET", "/api/plays")]
    [Covers("GET", "/api/plays/counts")]
    public async Task Play_lists_counts_searches_and_scopes_never_include_the_other_owner()
    {
        var (a, b) = api.Owners();
        var portfolio = await a.Portfolio(Isolated.Marker("portfolio-a"));
        var aAccount = (await a.ManualAccount(Isolated.Marker("manual-a"), portfolio)).GetProperty("id").GetGuid();
        var shared = Isolated.Marker("shared-title");
        var aPlay = Id(await Planned(a, aAccount, shared + " a", "manual"));
        var aDraft = Id(await Draft(a, aAccount, shared + " a draft", "manual"));
        var bAccount = (await b.ManualAccount(Isolated.Marker("manual-b"))).GetProperty("id").GetGuid();
        var bPlay = Id(await Draft(b, bAccount, shared + " b", "manual"));

        var search = Uri.EscapeDataString(shared);
        foreach (var (owner, mine, theirs) in new[] { (a, new[] { aPlay, aDraft }, new[] { bPlay }), (b, new[] { bPlay }, new[] { aPlay, aDraft }) })
        {
            foreach (var view in new[] { "drafts", "progress", "review", "reviewed", "closed", "cancelled", "all" })
            {
                var text = await owner.GetText($"/api/plays?view={view}&q={search}");
                Isolated.NoLeak(text, [.. theirs.Cast<object>()]);
            }
            var all = await owner.GetJson($"/api/plays?view=all&q={search}");
            Assert.Equal(mine.Order(), all.GetProperty("plays").EnumerateArray().Select(p => p.GetProperty("id").GetGuid()).Order());
            Assert.Equal(mine.Length, all.GetProperty("totalCount").GetInt32());
            Assert.Equal(mine.Length, (await owner.GetJson($"/api/plays/counts?q={search}")).GetProperty("all").GetInt32());
            Assert.Equal(mine.Length, (await owner.GetJson("/api/plays/counts")).GetProperty("all").GetInt32());
        }
        // A foreign account or portfolio scope answers like an unknown one.
        foreach (var path in new Func<Guid, string>[] { id => $"/api/plays?view=all&scope=account:{id}", id => $"/api/plays/counts?scope=account:{id}" })
            await Isolated.NotFound(b, aAccount, Isolated.Request(HttpMethod.Get, path));
        foreach (var path in new Func<Guid, string>[] { id => $"/api/plays?view=all&scope=portfolio:{id}", id => $"/api/plays/counts?scope=portfolio:{id}" })
            await Isolated.NotFound(b, portfolio, Isolated.Request(HttpMethod.Get, path));
        Assert.Equal(1, (await b.GetJson("/api/plays/counts?scope=unassigned")).GetProperty("all").GetInt32());
    }

    [PostgresFact]
    [Covers("GET", "/api/plays/{id:guid}/execution")]
    [Covers("POST", "/api/plays/{id:guid}/execution/check")]
    [Covers("POST", "/api/plays/{id:guid}/execution/links")]
    [Covers("DELETE", "/api/plays/{id:guid}/execution/links/{linkId:guid}")]
    public async Task Order_links_of_another_owner_answer_like_unknown_ones_and_stay_unchanged()
    {
        var (a, b) = api.Owners();
        var aAccount = (await a.SyncedVenueAccount(Isolated.Marker("venue-a"))).GetProperty("id").GetGuid();
        var play = Id(await Planned(a, aAccount, Isolated.Marker("linked-a")));
        // Positive control: A links its retained entry order explicitly.
        var execution = await a.Post($"/api/plays/{play}/execution/links", new LinkOrderRequest("entry", "entry", "entry-1"));
        var link = execution.GetProperty("links").EnumerateArray().Single(l => l.GetProperty("order").GetProperty("orderId").GetString() == "entry")
            .GetProperty("id").GetGuid();
        var paths = new[] { $"/api/plays/{play}", $"/api/plays/{play}/execution" };
        var before = await Isolated.State(a, paths);

        // B follows the same address, so the same native order IDs exist in its own account too.
        var bAccount = (await b.SyncedVenueAccount(Isolated.Marker("venue-b"))).GetProperty("id").GetGuid();
        var bPlay = Id(await Planned(b, bAccount, Isolated.Marker("linked-b")));
        var bPaths = new[] { $"/api/plays/{bPlay}", $"/api/plays/{bPlay}/execution" };
        var bBefore = await Isolated.State(b, bPaths);
        await Isolated.NotFound(b, play, Isolated.Request(HttpMethod.Get, id => $"/api/plays/{id}/execution"));
        await Isolated.NotFound(b, play, Isolated.Request(HttpMethod.Post, id => $"/api/plays/{id}/execution/check"));
        await Isolated.NotFound(b, play, Isolated.Request(HttpMethod.Post, id => $"/api/plays/{id}/execution/links",
            _ => new LinkOrderRequest("exit", "exit")));
        await Isolated.NotFound(b, play, Isolated.Request(HttpMethod.Delete, id => $"/api/plays/{id}/execution/links/{link}"));
        // A's link ID under B's own Play, and A's Play with B's route: neither unlinks anything.
        await Isolated.SameAsUnknown(b, link, Isolated.Request(HttpMethod.Delete, id => $"/api/plays/{bPlay}/execution/links/{id}"));
        Assert.Equal(before, await Isolated.State(a, paths));
        Assert.Equal(bBefore, await Isolated.State(b, bPaths));
        Isolated.NoLeak(bBefore, play, link, aAccount);

        // B links the same native order ID in its own account: a separate link that leaves A's untouched.
        var bExecution = await b.Post($"/api/plays/{bPlay}/execution/links", new LinkOrderRequest("entry", "entry", "entry-1"));
        var bLink = bExecution.GetProperty("links").EnumerateArray().Single(l => l.GetProperty("order").GetProperty("orderId").GetString() == "entry")
            .GetProperty("id").GetGuid();
        Assert.NotEqual(link, bLink);
        Isolated.NoLeak(bExecution.GetRawText(), play, link, aAccount);
        await b.Send(HttpMethod.Delete, $"/api/plays/{bPlay}/execution/links/{bLink}");
        Assert.Equal(before, await Isolated.State(a, paths));
        // A's own unlink still works afterwards.
        await a.Send(HttpMethod.Delete, $"/api/plays/{play}/execution/links/{link}");
    }

    [PostgresFact]
    [Covers("GET", "/api/plays/{id:guid}/manual-executions")]
    [Covers("POST", "/api/plays/{id:guid}/manual-executions")]
    [Covers("PUT", "/api/plays/{id:guid}/manual-executions/{executionId:guid}")]
    public async Task Manual_diary_of_another_owner_answers_like_unknown_and_request_ids_are_per_owner()
    {
        var (a, b) = api.Owners();
        var aAccount = (await a.ManualAccount(Isolated.Marker("manual-a"))).GetProperty("id").GetGuid();
        var aPlanned = await Planned(a, aAccount, Isolated.Marker("diary-a"), "manual");
        var aPlay = Id(aPlanned);
        var requestId = Guid.NewGuid();
        var entry = Fact(requestId, Version(aPlanned), "1", "100");
        var recorded = await a.Post($"/api/plays/{aPlay}/manual-executions", entry);
        var execution = Assert.Single(recorded.GetProperty("records").EnumerateArray()).GetProperty("id").GetGuid();
        var aVersion = Version(recorded.GetProperty("play"));
        var paths = new[] { $"/api/plays/{aPlay}/manual-executions", $"/api/plays/{aPlay}", $"/api/plays/{aPlay}/history" };
        var before = await Isolated.State(a, paths);

        var bAccount = (await b.ManualAccount(Isolated.Marker("manual-b"))).GetProperty("id").GetGuid();
        var bPlanned = await Planned(b, bAccount, Isolated.Marker("diary-b"), "manual");
        var bPlay = Id(bPlanned);
        await Isolated.NotFound(b, aPlay, Isolated.Request(HttpMethod.Get, id => $"/api/plays/{id}/manual-executions"));
        await Isolated.NotFound(b, aPlay, Isolated.Request(HttpMethod.Post, id => $"/api/plays/{id}/manual-executions",
            _ => Fact(Guid.NewGuid(), aVersion, "2", "90")));
        // A replay of A's own request ID against A's Play is still a foreign Play: no stored result is returned.
        await Isolated.NotFound(b, aPlay, Isolated.Request(HttpMethod.Post, id => $"/api/plays/{id}/manual-executions", _ => entry));
        await Isolated.NotFound(b, aPlay, Isolated.Request(HttpMethod.Put, id => $"/api/plays/{id}/manual-executions/{execution}",
            _ => Fact(Guid.NewGuid(), aVersion, "3", "80") with { Reason = "Taken" }));
        // A's execution ID under B's own Play.
        await Isolated.SameAsUnknown(b, execution, Isolated.Request(HttpMethod.Put, id => $"/api/plays/{bPlay}/manual-executions/{id}",
            _ => Fact(Guid.NewGuid(), Version(bPlanned), "3", "80") with { Reason = "Taken" }));
        Assert.Equal(before, await Isolated.State(a, paths));

        // B reuses A's request ID with different facts on its own Play: it records B's own execution,
        // neither replaying A's result nor conflicting with it.
        var reused = await b.Post($"/api/plays/{bPlay}/manual-executions", Fact(requestId, Version(bPlanned), "2", "200"));
        var bRecord = Assert.Single(reused.GetProperty("records").EnumerateArray());
        Assert.NotEqual(execution, bRecord.GetProperty("id").GetGuid());
        Assert.Equal(("2", "200"), (bRecord.GetProperty("quantity").GetString(), bRecord.GetProperty("price").GetString()));
        Assert.Equal(bPlay, Id(reused.GetProperty("play")));
        Isolated.NoLeak(reused.GetRawText(), aPlay, execution);
        Assert.Equal(before, await Isolated.State(a, paths));
        // A's retry of its own request still replays A's result.
        var replay = await a.Post($"/api/plays/{aPlay}/manual-executions", entry);
        Assert.Equal(execution, Assert.Single(replay.GetProperty("records").EnumerateArray()).GetProperty("id").GetGuid());
        Assert.Equal(before, await Isolated.State(a, paths));
    }

    private static ManualExecutionRequest Fact(Guid requestId, long version, string quantity, string price) =>
        new(requestId, version, "entry", "entry-1", AccountHistoryOrders.At, "buy", quantity, price, "0", "USDC", "Paper broker");
}

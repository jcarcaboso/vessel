using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Plays;
using Vessel.Application.Sizing;

namespace Vessel.Tests.Isolation;

/// <summary>
/// Both owners follow the same native address, so they retain identical source fill, order and funding IDs.
/// Overview, Activity, Review and Sizing must still answer each owner from its own copy only.
/// </summary>
public sealed class ReadModelIsolationTests(IsolationApi api) : IClassFixture<IsolationApi>
{
    private sealed record Journal(Owner Owner, Guid Portfolio, Guid Account, string Operation, Guid Play, string? Fingerprint = null);

    /// <summary>
    /// A portfolio, a synced account on the shared address and a Play over its one operation: a planned Play closed by
    /// explicitly linked orders (Review and Sizing count it), or a retrospective one (Review only) with
    /// <paramref name="requestId"/>.
    /// </summary>
    private static async Task<Journal> Import(Owner owner, Guid? requestId = null)
    {
        var portfolio = await owner.Portfolio(Isolated.Marker("portfolio"));
        var account = (await owner.SyncedVenueAccount(Isolated.Marker("venue"), portfolio)).GetProperty("id").GetGuid();
        var operation = Assert.Single((await owner.GetJson("/api/activity")).GetProperty("operations").EnumerateArray()).GetProperty("id").GetString()!;
        if (requestId is null)
        {
            var id = await owner.ClosedPlay(account, Isolated.Marker("planned"));
            return new(owner, portfolio, account, operation, id);
        }
        var preview = await owner.GetJson($"/api/activity/retrospective?accountId={account}&operationId={Uri.EscapeDataString(operation)}");
        Assert.True(preview.GetProperty("eligible").GetBoolean(), preview.GetRawText());
        var fingerprint = preview.GetProperty("fingerprint").GetString()!;
        var play = await owner.Post("/api/plays/retrospective", new CreateRetrospectiveRequest(requestId.Value, account, operation,
            fingerprint, RetrospectiveTitle(requestId.Value)));
        Assert.Equal("retrospective", play.GetProperty("summary").GetProperty("origin").GetString());
        return new(owner, portfolio, account, operation, play.GetProperty("summary").GetProperty("id").GetGuid(), fingerprint);
    }

    private static string RetrospectiveTitle(Guid requestId) => $"Retrospective {requestId:N}";

    private static string[] Reads(Journal journal) =>
    [
        "/api/overview", "/api/overview/summary?groupBy=account&period=all", "/api/overview/summary?period=all",
        "/api/activity", $"/api/activity?accountId={journal.Account}",
        $"/api/activity/fills?accountId={journal.Account}&operationId={Uri.EscapeDataString(journal.Operation)}",
        "/api/review?period=all", "/api/review/exclusions?period=all", "/api/sizing", "/api/plays?view=all"
    ];

    [PostgresFact]
    [Covers("GET", "/api/overview")]
    [Covers("GET", "/api/overview/summary")]
    [Covers("GET", "/api/activity")]
    [Covers("GET", "/api/activity/fills")]
    [Covers("GET", "/api/review")]
    [Covers("GET", "/api/review/exclusions")]
    [Covers("GET", "/api/sizing")]
    public async Task Shared_venue_identities_stay_separate_and_correct_for_each_owner()
    {
        var (aOwner, bOwner) = api.Owners();
        var a = await Import(aOwner);
        var b = await Import(bOwner);
        // Operation IDs are Vessel row identities, so each owner's differ even over the same native fills.
        Assert.NotEqual(a.Operation, b.Operation);
        await using (var aDb = api.Database.Context(a.Owner.Id))
        await using (var bDb = api.Database.Context(b.Owner.Id))
        {
            // The same native identities are retained once per owner.
            var aFills = await aDb.Fills.Select(f => f.SourceFillId).OrderBy(id => id).ToListAsync();
            Assert.Equal(["entry-fill", "exit-fill"], aFills);
            Assert.Equal(aFills, await bDb.Fills.Select(f => f.SourceFillId).OrderBy(id => id).ToListAsync());
            Assert.Equal(await aDb.Orders.Select(o => o.OrderId).OrderBy(id => id).ToListAsync(),
                await bDb.Orders.Select(o => o.OrderId).OrderBy(id => id).ToListAsync());
            Assert.Equal([IsolationVenues.FundedReader.FundingId], await aDb.FundingPayments.Select(p => p.SourceId).ToListAsync());
            Assert.Equal([IsolationVenues.FundedReader.FundingId], await bDb.FundingPayments.Select(p => p.SourceId).ToListAsync());
            Assert.Equal(1, await aDb.Accounts.CountAsync(x => x.Address == IsolationVenues.Address));
            Assert.Equal(1, await bDb.Accounts.CountAsync(x => x.Address == IsolationVenues.Address));
        }

        foreach (var (mine, theirs) in new[] { (a, b), (b, a) })
        {
            var owner = mine.Owner;
            foreach (var path in Reads(mine))
                Isolated.NoLeak(await owner.GetText(path), theirs.Account, theirs.Portfolio, theirs.Play);

            var overview = await owner.GetJson("/api/overview");
            Assert.Equal([mine.Account], overview.GetProperty("accounts").EnumerateArray().Select(x => x.GetProperty("id").GetGuid()));
            Assert.Equal([mine.Portfolio], overview.GetProperty("portfolios").EnumerateArray().Select(x => x.GetProperty("id").GetGuid()));
            Assert.Equal("1000", overview.GetProperty("accounts")[0].GetProperty("accountValueUsd").GetString());
            Assert.Equal(2, overview.GetProperty("recentActivity").GetArrayLength());

            var summary = await owner.GetJson("/api/overview/summary?groupBy=account&period=all");
            Assert.Equal(1, summary.GetProperty("totals").GetProperty("accountCount").GetInt32());
            Assert.Equal(2, summary.GetProperty("totals").GetProperty("importedFillCount").GetInt32());
            Assert.Equal($"account:{mine.Account}", Assert.Single(summary.GetProperty("rows").EnumerateArray()).GetProperty("id").GetString());

            var activity = await owner.GetJson("/api/activity");
            var operation = Assert.Single(activity.GetProperty("operations").EnumerateArray());
            Assert.Equal(mine.Account, operation.GetProperty("accountId").GetGuid());
            Assert.Equal(mine.Play, operation.GetProperty("playId").GetGuid());
            Assert.Equal("10", operation.GetProperty("reportedClosedPnlUsd").GetString());
            Assert.Equal(2, operation.GetProperty("fillCount").GetInt32());
            Assert.Equal(2, activity.GetProperty("retainedFillCount").GetInt32());

            var fills = await owner.GetJson($"/api/activity/fills?accountId={mine.Account}&operationId={Uri.EscapeDataString(mine.Operation)}");
            Assert.Equal(2, fills.GetProperty("fills").GetArrayLength());

            var review = await owner.GetJson("/api/review?period=all");
            Assert.Equal(1, review.GetProperty("metrics").GetProperty("count").GetInt32());
            Assert.Equal([mine.Play], review.GetProperty("plays").EnumerateArray().Select(x => x.GetProperty("id").GetGuid()));

            var sizing = await owner.GetJson("/api/sizing");
            Assert.Equal(1, sizing.GetProperty("record").GetProperty("closedPlays").GetInt32());
            Assert.Equal([mine.Play], sizing.GetProperty("record").GetProperty("recent").EnumerateArray().Select(x => x.GetProperty("playId").GetGuid()));
        }
        // Both owners read the same facts, so the owner-independent parts of their answers agree.
        var aActivity = await a.Owner.GetText("/api/activity");
        var bActivity = await b.Owner.GetText("/api/activity");
        Assert.Equal(Normalize(aActivity, a), Normalize(bActivity, b));
    }

    // The version token hashes owner-specific row identities.
    private static string Normalize(string body, Journal journal) => System.Text.RegularExpressions.Regex.Replace(body, "\"version\":\"[^\"]*\"", "")
        .Replace(journal.Operation, "{operation}", StringComparison.OrdinalIgnoreCase)
        .Replace(journal.Account.ToString("D"), "{account}", StringComparison.OrdinalIgnoreCase)
        .Replace(journal.Portfolio.ToString("D"), "{portfolio}", StringComparison.OrdinalIgnoreCase)
        .Replace(journal.Play.ToString("D"), "{play}", StringComparison.OrdinalIgnoreCase);

    [PostgresFact]
    [Covers("GET", "/api/activity/retrospective")]
    [Covers("POST", "/api/plays/retrospective")]
    public async Task Retrospective_request_ids_are_per_owner_and_reviews_stay_separate()
    {
        var (aOwner, bOwner) = api.Owners();
        // The same request ID in both owners: B's retrospective is its own, not a replay of A's.
        var requestId = Guid.NewGuid();
        var a = await Import(aOwner, requestId);
        var b = await Import(bOwner, requestId);
        Assert.NotEqual(a.Play, b.Play);
        foreach (var (mine, theirs) in new[] { (a, b), (b, a) })
        {
            var play = await mine.Owner.GetJson($"/api/plays/{mine.Play}");
            Assert.Equal(mine.Account, play.GetProperty("summary").GetProperty("accountId").GetGuid());
            var review = await mine.Owner.GetJson("/api/review?period=all");
            Assert.Equal([mine.Play], review.GetProperty("plays").EnumerateArray().Select(x => x.GetProperty("id").GetGuid()));
            Assert.Equal(mine.Play, Assert.Single((await mine.Owner.GetJson("/api/activity")).GetProperty("operations").EnumerateArray())
                .GetProperty("playId").GetGuid());
            foreach (var path in Reads(mine))
                Isolated.NoLeak(await mine.Owner.GetText(path), theirs.Account, theirs.Portfolio, theirs.Play);
        }
        // A's retry of its own request still answers A's Play, and B's retry B's.
        var replay = await a.Owner.Post("/api/plays/retrospective", new CreateRetrospectiveRequest(requestId, a.Account, a.Operation,
            a.Fingerprint!, RetrospectiveTitle(requestId)));
        Assert.Equal(b.Play, (await b.Owner.Post("/api/plays/retrospective", new CreateRetrospectiveRequest(requestId, b.Account, b.Operation,
            b.Fingerprint!, RetrospectiveTitle(requestId)))).GetProperty("summary").GetProperty("id").GetGuid());
        // B sending A's exact request (A's account, operation and fingerprint) never receives A's stored Play.
        await Isolated.NotFound(b.Owner, a.Account, Isolated.Request(HttpMethod.Post, _ => "/api/plays/retrospective",
            id => new CreateRetrospectiveRequest(Guid.NewGuid(), id, a.Operation, a.Fingerprint!, RetrospectiveTitle(requestId))));
        Assert.Equal(a.Play, replay.GetProperty("summary").GetProperty("id").GetGuid());
    }

    [PostgresFact]
    public async Task Read_filters_naming_the_other_owners_ids_answer_like_unknown_ones()
    {
        var (aOwner, bOwner) = api.Owners();
        var a = await Import(aOwner);
        var b = await Import(bOwner);
        var aState = await Isolated.State(a.Owner, Reads(a));
        var operation = Uri.EscapeDataString(a.Operation);
        var byAccount = new Func<Guid, string>[]
        {
            id => $"/api/activity?accountId={id}",
            id => $"/api/activity?scope=account:{id}",
            id => $"/api/activity?account={id}",
            id => $"/api/activity/fills?accountId={id}&operationId={operation}",
            id => $"/api/activity/retrospective?accountId={id}&operationId={operation}",
            id => $"/api/overview/summary?scope=account:{id}",
            id => $"/api/review?period=all&accountId={id}",
            id => $"/api/review/exclusions?period=all&accountId={id}"
        };
        foreach (var path in byAccount)
            await Isolated.SameAsUnknown(b.Owner, a.Account, Isolated.Request(HttpMethod.Get, path));
        var byPortfolio = new Func<Guid, string>[]
        {
            id => $"/api/activity?scope=portfolio:{id}",
            id => $"/api/activity?portfolio={id}",
            id => $"/api/overview/summary?scope=portfolio:{id}",
            id => $"/api/review?period=all&portfolio={id}",
            id => $"/api/review/exclusions?period=all&portfolio={id}"
        };
        foreach (var path in byPortfolio)
            await Isolated.SameAsUnknown(b.Owner, a.Portfolio, Isolated.Request(HttpMethod.Get, path));
        // The detail and scope reads that 404 for unknown accounts do so for foreign ones as well.
        foreach (var path in new[] { byAccount[0], byAccount[1], byAccount[3], byAccount[4], byAccount[5] })
            await Isolated.NotFound(b.Owner, a.Account, Isolated.Request(HttpMethod.Get, path));

        // A retrospective naming A's account creates nothing.
        var bState = await Isolated.State(b.Owner, Reads(b));
        await Isolated.NotFound(b.Owner, a.Account, Isolated.Request(HttpMethod.Post, _ => "/api/plays/retrospective",
            id => new CreateRetrospectiveRequest(Guid.NewGuid(), id, a.Operation, "fingerprint", "taken-by-b")));
        Assert.Equal(bState, await Isolated.State(b.Owner, Reads(b)));
        Assert.Equal(aState, await Isolated.State(a.Owner, Reads(a)));
    }

    [PostgresFact]
    [Covers("PUT", "/api/sizing/settings")]
    public async Task Sizing_settings_are_per_owner()
    {
        var (a, b) = api.Owners();
        var aSettings = await a.Send(HttpMethod.Put, "/api/sizing/settings", new UpdateSizingSettingsRequest("0.5"));
        Assert.Equal("0.5", aSettings.GetProperty("settings").GetProperty("riskPercent").GetString());
        Assert.Equal("1.25", (await b.GetJson("/api/sizing")).GetProperty("settings").GetProperty("riskPercent").GetString());
        await b.Send(HttpMethod.Put, "/api/sizing/settings", new UpdateSizingSettingsRequest("2"));
        Assert.Equal("0.5", (await a.GetJson("/api/sizing")).GetProperty("settings").GetProperty("riskPercent").GetString());
        Assert.Equal("2", (await b.GetJson("/api/sizing")).GetProperty("settings").GetProperty("riskPercent").GetString());
    }
}

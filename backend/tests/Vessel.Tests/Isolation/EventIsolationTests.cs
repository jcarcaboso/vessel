using System.Net;
using System.Text.Json;

namespace Vessel.Tests.Isolation;

/// <summary>The event page, its cursors and the event stream across two owners.</summary>
public sealed class EventIsolationTests(IsolationApi api) : IClassFixture<IsolationApi>
{
    private static async Task<(Guid Account, Guid Play)> Journal(Owner owner)
    {
        var account = (await owner.SyncedVenueAccount(Isolated.Marker("venue"))).GetProperty("id").GetGuid();
        return (account, await owner.ClosedPlay(account, Isolated.Marker("events")));
    }

    /// <summary>The page holds the caller's own events of its one journal; returns their types in order.</summary>
    private static List<string> OnlyOwn(JsonElement page, Owner owner, Guid play)
    {
        var events = page.GetProperty("events").EnumerateArray().ToList();
        Assert.All(events, e => Assert.Equal(owner.Id, e.GetProperty("ownerId").GetGuid()));
        var types = events.Select(e => e.GetProperty("type").GetString()!).ToList();
        Assert.Contains("play.opened", types);
        Assert.Contains("play.closed", types);
        Assert.Contains(play.ToString("D"), page.GetRawText(), StringComparison.OrdinalIgnoreCase);
        return types;
    }

    [PostgresFact]
    [Covers("GET", "/api/events")]
    public async Task Event_pages_and_cursors_never_return_the_other_owners_events()
    {
        var (a, b) = api.Owners();
        var (aAccount, aPlay) = await Journal(a);
        var (bAccount, bPlay) = await Journal(b);
        var aPage = await a.GetJson("/api/events");
        var bPage = await b.GetJson("/api/events");
        // The same journal on both sides produces the same event types, each owner's own.
        Assert.Equal(OnlyOwn(aPage, a, aPlay), OnlyOwn(bPage, b, bPlay));
        Isolated.NoLeak(aPage.GetRawText(), bAccount, bPlay, b.Id);
        Isolated.NoLeak(bPage.GetRawText(), aAccount, aPlay, a.Id);

        // Cursors are positions, not grants: another owner's cursor, at its start or at its end, still pages only
        // the caller's own events.
        var aFirst = await a.GetJson("/api/events?limit=1");
        foreach (var cursor in new[] { aFirst.GetProperty("nextCursor").GetString()!, aPage.GetProperty("nextCursor").GetString()! })
        {
            var page = await b.GetText($"/api/events?after={Uri.EscapeDataString(cursor)}");
            Isolated.NoLeak(page, aAccount, aPlay, a.Id);
        }
        var bFirst = await b.GetJson("/api/events?limit=1");
        Assert.Equal(b.Id, Assert.Single(bFirst.GetProperty("events").EnumerateArray()).GetProperty("ownerId").GetGuid());
        var bRest = await b.GetJson($"/api/events?after={Uri.EscapeDataString(bFirst.GetProperty("nextCursor").GetString()!)}");
        var rest = bRest.GetProperty("events").EnumerateArray().ToList();
        Assert.Equal(bPage.GetProperty("events").GetArrayLength() - 1, rest.Count);
        Assert.All(rest, e => Assert.Equal(b.Id, e.GetProperty("ownerId").GetGuid()));
        // A's page is unchanged by B's reads.
        Assert.Equal(aPage.GetRawText(), (await a.GetJson("/api/events")).GetRawText());
    }

    [PostgresFact]
    [Covers("GET", "/api/events/stream")]
    public async Task Event_streams_deliver_only_the_callers_events_and_cap_streams_per_owner()
    {
        var (a, b) = api.Owners();
        var (aAccount, aPlay) = await Journal(a);
        var (bAccount, bPlay) = await Journal(b);
        var aCursor = (await a.GetJson("/api/events?limit=1")).GetProperty("nextCursor").GetString()!;

        foreach (var (owner, play, foreign) in new[] { (a, aPlay, new object[] { bAccount, bPlay, b.Id }), (b, bPlay, [aAccount, aPlay, a.Id]) })
        {
            var own = (await owner.GetJson("/api/events")).GetProperty("events").GetArrayLength();
            var frames = await Frames(owner, "/api/events/stream", count: own);
            Assert.Contains(play.ToString("D"), frames, StringComparison.OrdinalIgnoreCase);
            Isolated.NoLeak(frames, foreign);
        }
        // B resuming from A's cursor still reads only B's events.
        Isolated.NoLeak(await Frames(b, $"/api/events/stream?after={Uri.EscapeDataString(aCursor)}", count: 0), aAccount, aPlay, a.Id);

        // A's four open streams use A's cap only: A's fifth is refused, B still streams.
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var open = new List<HttpResponseMessage>();
        try
        {
            for (var i = 0; i < 4; i++)
            {
                var response = await a.Http.SendAsync(new(HttpMethod.Get, "/api/events/stream"), HttpCompletionOption.ResponseHeadersRead, cancel.Token);
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                open.Add(response);
            }
            using var refused = await a.Http.GetAsync("/api/events/stream", cancel.Token);
            Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
            using var other = await b.Http.SendAsync(new(HttpMethod.Get, "/api/events/stream"), HttpCompletionOption.ResponseHeadersRead, cancel.Token);
            Assert.Equal(HttpStatusCode.OK, other.StatusCode);
        }
        finally
        {
            foreach (var response in open) response.Dispose();
        }
    }

    /// <summary>Reads stream frames until the status frame and <paramref name="count"/> event frames arrived, then disconnects.</summary>
    private static async Task<string> Frames(Owner owner, string path, int count)
    {
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        using var response = await owner.Http.SendAsync(new(HttpMethod.Get, path), HttpCompletionOption.ResponseHeadersRead, cancel.Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var body = await response.Content.ReadAsStreamAsync(cancel.Token);
        using var reader = new StreamReader(body);
        var text = new System.Text.StringBuilder();
        var events = 0;
        var status = false;
        // The first keepalive follows the initial page, so every frame of that page has been read by then.
        while (await reader.ReadLineAsync(cancel.Token) is { } line)
        {
            text.AppendLine(line);
            if (line == "event: status") status = true;
            if (line == "event: event") events++;
            if (status && events >= count && line == ": keepalive") break;
        }
        Assert.True(status, text.ToString());
        Assert.Equal(count, events);
        return text.ToString();
    }
}

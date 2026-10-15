using System.Text.Json;
using Vessel.Application.Events;

namespace Vessel.Tests;

public sealed class VesselEventGoldenTests
{
    public static TheoryData<string, string> VersionOnePayloads => new()
    {
        { "play.opened", """{"previous":"planned","current":"open","source":"venue"}""" },
        { "play.closed", """{"enteredQuantity":"0.5","exitedQuantity":"0.5","closedPnlUsd":"-0.001","closedPnlBasis":"net-of-fee","fees":[{"token":"USDC","amount":"0.0001"}]}""" },
        { "play.status-changed", """{"previous":"planned","current":"paused","source":"owner","reason":null}""" },
        { "execution.filled", """{"role":"stop","side":"sell","filledQuantity":"0.25","cumulativeQuantity":"0.5","remainingQuantity":"0","averagePrice":"83900.00000000000000000001","complete":true}""" },
        { "link.needs-confirmation", """{"linkId":"22222222-2222-2222-2222-222222222222","previous":null,"current":"suggested","role":"entry","source":"automatic"}""" },
        { "execution.link-changed", """{"linkId":"22222222-2222-2222-2222-222222222222","previous":"suggested","current":"linked","role":"entry","source":"owner"}""" },
        { "discrepancy.opened", """{"kind":"position.short","details":{"expectedQuantity":"1.00","venueQuantity":"0.5"}}""" },
        { "discrepancy.resolved", """{"kind":"position.short","state":"resolved"}""" },
        { "monitor.state-changed", """{"previous":"live","current":"degraded"}""" },
        { "credential.expiring", """{"expiresAtUtc":"2026-10-28T00:00:00+00:00"}""" }
    };

    [Theory]
    [MemberData(nameof(VersionOnePayloads))]
    public void Version_one_event_json_matches_the_golden_wire_contract(string type, string data)
    {
        using var payload = JsonDocument.Parse(data);
        var at = DateTimeOffset.Parse("2026-10-14T03:20:41+00:00", System.Globalization.CultureInfo.InvariantCulture);
        var message = new VesselEvent(Guid.Parse("0192f0c4-1234-7000-8000-000000000001"), type, 1,
            Guid.Parse("11111111-1111-1111-1111-111111111111"), "9007199254740993",
            Guid.Parse("0192f0c4-1234-7000-8000-000000000002"), "stable-source-key", "info",
            at, at, "timely", "current", null, new(), new("monitor", ["order-1"], ["fill-1"]), payload.RootElement.Clone());
        var expected = """{"id":"0192f0c4-1234-7000-8000-000000000001","type":""" + "\"" + type + "\"" +
            ""","version":1,"ownerId":"11111111-1111-1111-1111-111111111111","sequence":"9007199254740993","runId":"0192f0c4-1234-7000-8000-000000000002","dedupKey":"stable-source-key","severity":"info","occurredAt":"2026-10-14T03:20:41+00:00","detectedAt":"2026-10-14T03:20:41+00:00","timeliness":"timely","relevance":"current","expiresAt":null,"subject":{},"source":{"trigger":"monitor","orderIds":["order-1"],"fillIds":["fill-1"]},"data":""" +
            (type == "credential.expiring" ? """{"expiresAtUtc":"2026-10-28T00:00:00\u002B00:00"}""" : data) + "}";
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Equal(expected, JsonSerializer.Serialize(message, options));
        Assert.Equal(message.Id, JsonSerializer.Deserialize<VesselEvent>(expected, options)!.Id);
        Assert.Contains(type, VesselEventValues.Types);
    }
}

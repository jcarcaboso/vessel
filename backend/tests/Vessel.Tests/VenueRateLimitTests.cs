using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Infrastructure.Venues.Common;

namespace Vessel.Tests;

public sealed class VenueRateLimitTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 15, 8, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Http429_preserves_delta_and_date_retry_deadlines_without_response_secrets(bool httpDate)
    {
        using var http = new HttpClient(new Limited(httpDate)) { BaseAddress = new("https://synthetic.invalid") };
        var reader = new BoundedJsonHttp(http, new Clock(), new StrictJson("Invalid synthetic read."), "Unavailable.", "Timed out.");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/read");
        var error = await Assert.ThrowsAsync<VenueRateLimitException>(() =>
            reader.ReadBoundedAsync(ct => reader.SendAsync(request, ct), default));
        Assert.Equal(Now.AddSeconds(600), error.RetryAtUtc);
        Assert.DoesNotContain("SECRET", error.ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("invalid deadline")]
    public async Task Missing_or_invalid_retry_header_uses_the_sixty_second_fallback(string? value)
    {
        using var http = new HttpClient(new MissingRetry(value)) { BaseAddress = new("https://synthetic.invalid") };
        var reader = new BoundedJsonHttp(http, new Clock(), new StrictJson("Invalid synthetic read."), "Unavailable.", "Timed out.");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/read");
        var error = await Assert.ThrowsAsync<VenueRateLimitException>(() => reader.SendAsync(request, default));
        Assert.Equal(Now.AddSeconds(60), error.RetryAtUtc);
    }

    [PostgresFact]
    public async Task Api_refresh_manual_and_legacy_check_report_the_persisted_venue_retry_after()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var first = new Account(Guid.NewGuid(), owner, "hyperliquid", "Limited account");
        var second = new Account(Guid.NewGuid(), owner, "hyperliquid", "Other account on the same venue");
        first.Configure(null, "0x" + new string('a', 40), null);
        second.Configure(null, "0x" + new string('b', 40), null);
        var play = new Play(Guid.NewGuid(), second, new PerpetualInstrument("hyperliquid", "BTC"),
            InstrumentSource.Venue, "{}", Now.AddMinutes(-2));
        play.MarkPlanned(Now.AddMinutes(-1));
        await using (var seed = database.Context(owner))
        {
            seed.AddRange(first, second, play);
            await seed.SaveChangesAsync();
        }
        var orders = new AccountHistoryOrders { Failure = new VenueRateLimitException(Now.AddSeconds(600)) };
        await using var factory = new CoreApiFactory(owner, connection: database.ConnectionString, configure: services =>
        {
            services.AddSingleton<TimeProvider>(new Clock());
            services.AddSingleton<IVenueRegistry>(AccountHistoryOrders.Registry(AccountHistoryOrders.PublicReader(), orders));
        });
        using var client = factory.AuthorizedClient();
        using var publicSuccess = await client.PostAsync($"/api/accounts/{first.Id}/sync", null);
        publicSuccess.EnsureSuccessStatusCode();
        Assert.Contains("rate limit", (await publicSuccess.Content.ReadFromJsonAsync<AccountDto>())!.HistoryNotice);
        foreach (var route in new[] { $"/api/accounts/{second.Id}/sync", $"/api/accounts/{second.Id}/monitor/run",
            $"/api/plays/{play.Id}/execution/check" })
        {
            using var denied = await client.PostAsync(route, null);
            Assert.Equal(HttpStatusCode.TooManyRequests, denied.StatusCode);
            Assert.Equal(TimeSpan.FromSeconds(600), denied.Headers.RetryAfter!.Delta);
        }
        Assert.Equal(1, orders.Reads);
    }

    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
    private sealed class MissingRetry(string? value) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            if (value is not null) response.Headers.TryAddWithoutValidation("Retry-After", value);
            return Task.FromResult(response);
        }
    }
    private sealed class Limited(bool httpDate) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests) { Content = new StringContent("SECRET") };
            response.Headers.RetryAfter = httpDate ? new RetryConditionHeaderValue(Now.AddSeconds(600)) :
                new RetryConditionHeaderValue(TimeSpan.FromSeconds(600));
            return Task.FromResult(response);
        }
    }
}

using System.Net;
using System.Net.Http.Json;
using Vessel.Application.Overview;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Tests;

public sealed class OverviewSummaryPostgresTests
{
    [PostgresFact]
    public async Task Endpoint_uses_owner_enabled_facts_exact_amounts_and_current_membership()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var foreignOwner = Guid.NewGuid();
        var portfolio = new Portfolio(Guid.NewGuid(), owner, "Swing", "wallet");
        var account = new Account(Guid.NewGuid(), owner, "manual", "Owned"); account.Configure(portfolio.Id, null, 10.000000000000000000000000001m);
        var unassigned = new Account(Guid.NewGuid(), owner, "manual", "Unassigned"); unassigned.Configure(null, null, 20);
        var disabled = new Account(Guid.NewGuid(), owner, "manual", "Disabled"); disabled.Configure(null, null, 999); disabled.UpdateSettings(disabled.Name, null, false);
        var foreign = new Account(Guid.NewGuid(), foreignOwner, "manual", "Foreign"); foreign.Configure(null, null, 1000);
        var foreignPortfolio = new Portfolio(Guid.NewGuid(), foreignOwner, "Foreign");
        var now = DateTimeOffset.UtcNow.AddHours(-1);
        await using (var db = database.Context(owner))
        {
            db.Portfolios.Add(portfolio); db.Accounts.AddRange(account, unassigned, disabled);
            foreach (var a in new[] { account, disabled })
                foreach (var close in new[] { false, true })
                    db.Fills.Add(new ImportedFill { Id = Guid.NewGuid(), OwnerId = owner, AccountId = a.Id, ContractId = "BTC",
                        SourceFillId = close ? "close" : "open", Side = close ? "sell" : "buy", PositionEffect = close ? "close" : "open",
                        Direction = "Fixture", Price = 100, Quantity = 1, Fee = 0.0000000000000000000000000001m, FeeToken = "USDC",
                        ClosedPnlUsd = close ? 10 : 0, OccurredAtUtc = close ? now : now.AddHours(-1), OrderId = close ? "close" : "open", TransactionHash = "" });
            await db.SaveChangesAsync();
        }
        await using (var db = database.Context(foreignOwner)) { db.Portfolios.Add(foreignPortfolio); db.Accounts.Add(foreign); await db.SaveChangesAsync(); }
        await using var factory = new CoreApiFactory(owner, connection: database.ConnectionString); using var client = factory.AuthorizedClient();
        using var response = await client.GetAsync("/api/overview/summary?groupBy=portfolio&period=30&scope=all");
        response.EnsureSuccessStatusCode(); Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        var result = (await response.Content.ReadFromJsonAsync<OverviewSummaryDto>())!;
        Assert.Equal(2, result.Totals.AccountCount); Assert.Equal("30.000000000000000000000000001", result.Totals.Balance.AmountUsd);
        Assert.Equal("9.9999999999999999999999999998", result.Totals.RealizedResult.AmountUsd);
        Assert.Equal(2, result.Totals.ImportedFillCount); Assert.Equal("unassigned", result.Rows[0].Id);
        foreach (var scope in new[] { $"account:{foreign.Id}", $"portfolio:{foreignPortfolio.Id}", $"account:{Guid.NewGuid()}" })
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/overview/summary?scope={scope}")).StatusCode);
        await using (var db = database.Context(owner))
        {
            var a = await db.Accounts.FindAsync(account.Id); a!.UpdateSettings(a.Name, null, false); await db.SaveChangesAsync();
        }
        var after = (await client.GetFromJsonAsync<OverviewSummaryDto>("/api/overview/summary"))!;
        Assert.Equal("20", after.Totals.Balance.AmountUsd); Assert.Single(after.Rows); Assert.Null(after.Totals.RealizedResult.AmountUsd);
    }
}

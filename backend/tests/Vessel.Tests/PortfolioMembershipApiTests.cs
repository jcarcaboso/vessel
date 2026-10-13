using System.Net;
using System.Net.Http.Json;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Tests;

public sealed class PortfolioMembershipApiTests
{
    [Theory]
    [InlineData("/api/accounts/portfolio")]
    [InlineData("/api/portfolios")]
    public async Task Requires_authentication(string path)
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid()); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(path, new { name = "Test", accountIds = new[] { Guid.NewGuid() }, portfolioId = (Guid?)null })).StatusCode);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"accountIds\":[]}")]
    [InlineData("{\"portfolioId\":null}")]
    [InlineData("{\"accountIds\":null,\"portfolioId\":null}")]
    [InlineData("{\"accountIds\":[],\"portfolioId\":null}")]
    public async Task Rejects_missing_null_or_empty_ids_and_requires_explicit_target(string json)
    {
        var owner = Guid.NewGuid(); await using var factory = new CoreApiFactory(owner, new MemoryWorkspaceStore(owner)); using var client = factory.AuthorizedClient();
        var response = await client.PostAsync("/api/accounts/portfolio", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Move_and_create_endpoints_return_updated_resources()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        var account = new Account(Guid.NewGuid(), owner, "manual", "Account"); store.Accounts.Add(account);
        var portfolio = new Portfolio(Guid.NewGuid(), owner, "Target"); store.Portfolios.Add(portfolio);
        await using var factory = new CoreApiFactory(owner, store); using var client = factory.AuthorizedClient();
        var moved = await client.PostAsJsonAsync("/api/accounts/portfolio", new MoveAccountsRequest([account.Id], portfolio.Id));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode); Assert.Equal(portfolio.Id, (await moved.Content.ReadFromJsonAsync<List<AccountDto>>())!.Single().PortfolioId);
        var created = await client.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest("New", AccountIds: [account.Id]));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode); var result = (await created.Content.ReadFromJsonAsync<PortfolioDto>())!;
        Assert.Equal(1, result.AccountCount); Assert.Equal(result.Id, account.PortfolioId); Assert.Equal(3, account.SettingsRevision);
    }
}

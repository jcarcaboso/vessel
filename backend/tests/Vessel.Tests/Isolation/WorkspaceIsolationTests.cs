using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Credentials;
using Vessel.Application.Workspace;

namespace Vessel.Tests.Isolation;

/// <summary>Portfolios, accounts, bulk membership, credentials and the account sub-resources across two owners.</summary>
public sealed class WorkspaceIsolationTests(IsolationApi api) : IClassFixture<IsolationApi>
{
    [PostgresFact]
    [Covers("GET", "/api/portfolios")]
    [Covers("GET", "/api/portfolios/{id:guid}")]
    [Covers("POST", "/api/portfolios")]
    [Covers("PATCH", "/api/portfolios/{id:guid}")]
    [Covers("DELETE", "/api/portfolios/{id:guid}")]
    public async Task Portfolios_of_another_owner_answer_like_unknown_ones_and_stay_unchanged()
    {
        var (a, b) = api.Owners();
        var name = Isolated.Marker("portfolio-a");
        var portfolio = await a.Portfolio(name);
        var account = (await a.ManualAccount(Isolated.Marker("account-a"), portfolio)).GetProperty("id").GetGuid();
        Assert.Equal(name, (await a.GetJson($"/api/portfolios/{portfolio}")).GetProperty("name").GetString());
        var before = await Isolated.State(a, "/api/portfolios", $"/api/portfolios/{portfolio}", $"/api/accounts/{account}");
        await b.Portfolio(Isolated.Marker("portfolio-b"));

        await Isolated.NotFound(b, portfolio, Isolated.Request(HttpMethod.Get, id => $"/api/portfolios/{id}"));
        await Isolated.NotFound(b, portfolio, Isolated.Request(HttpMethod.Patch, id => $"/api/portfolios/{id}",
            _ => new UpdatePortfolioRequest("renamed-by-b", "folder")));
        await Isolated.NotFound(b, portfolio, Isolated.Request(HttpMethod.Delete, id => $"/api/portfolios/{id}"));
        Assert.Equal(before, await Isolated.State(a, "/api/portfolios", $"/api/portfolios/{portfolio}", $"/api/accounts/{account}"));

        var list = await b.GetText("/api/portfolios");
        Isolated.NoLeak(list, portfolio, name, account);
        Assert.Single((await b.GetJson("/api/portfolios")).EnumerateArray());
        // A's own delete still works afterwards: B's attempts did not lock or alter it.
        await a.Send(HttpMethod.Delete, $"/api/portfolios/{portfolio}", expected: HttpStatusCode.NoContent);
        Assert.Equal(JsonValueKind.Null, (await a.GetJson($"/api/accounts/{account}")).GetProperty("portfolioId").ValueKind);
    }

    [PostgresFact]
    [Covers("GET", "/api/accounts")]
    [Covers("GET", "/api/accounts/{id:guid}")]
    [Covers("POST", "/api/accounts")]
    [Covers("PUT", "/api/accounts/{id:guid}")]
    [Covers("DELETE", "/api/accounts/{id:guid}")]
    public async Task Accounts_of_another_owner_answer_like_unknown_ones_and_stay_unchanged()
    {
        var (a, b) = api.Owners();
        var portfolio = await a.Portfolio(Isolated.Marker("portfolio-a"));
        var name = Isolated.Marker("account-a");
        var created = await a.ManualAccount(name, portfolio);
        var account = created.GetProperty("id").GetGuid();
        var revision = created.GetProperty("settingsRevision").GetInt64();
        Assert.Equal(name, (await a.GetJson($"/api/accounts/{account}")).GetProperty("name").GetString());
        var paths = new[] { "/api/accounts", $"/api/accounts/{account}", "/api/portfolios", "/api/overview" };
        var before = await Isolated.State(a, paths);

        var own = await b.ManualAccount(Isolated.Marker("account-b"));
        var ownId = own.GetProperty("id").GetGuid();
        var ownRevision = own.GetProperty("settingsRevision").GetInt64();
        await Isolated.NotFound(b, account, Isolated.Request(HttpMethod.Get, id => $"/api/accounts/{id}"));
        // Disable, rename and move through the route: the request is otherwise valid for an owned account.
        await Isolated.NotFound(b, account, Isolated.Request(HttpMethod.Put, id => $"/api/accounts/{id}",
            _ => new UpdateAccountRequest("taken-by-b", null, false, revision)));
        await Isolated.NotFound(b, account, Isolated.Request(HttpMethod.Delete, id => $"/api/accounts/{id}"));
        Assert.Equal(before, await Isolated.State(a, paths));

        // A foreign portfolio in a body answers like an unknown portfolio, and creates or moves nothing.
        var bBefore = await Isolated.State(b, "/api/accounts", "/api/portfolios");
        await Isolated.SameAsUnknown(b, portfolio, Isolated.Request(HttpMethod.Post, _ => "/api/accounts",
            id => new CreateAccountRequest(id, "into-foreign-portfolio", "manual", ManualAccountValueUsd: "1")));
        await Isolated.SameAsUnknown(b, portfolio, Isolated.Request(HttpMethod.Put, _ => $"/api/accounts/{ownId}",
            id => new UpdateAccountRequest("moved-into-foreign", id, true, ownRevision)));
        Assert.Equal(bBefore, await Isolated.State(b, "/api/accounts", "/api/portfolios"));
        Assert.Equal(before, await Isolated.State(a, paths));

        var list = await b.GetText("/api/accounts");
        Isolated.NoLeak(list, account, name, portfolio);
        Assert.Single((await b.GetJson("/api/accounts")).EnumerateArray());
        Isolated.NoLeak(await b.GetText("/api/overview"), account, name, portfolio);
    }

    [PostgresFact]
    [Covers("POST", "/api/accounts/portfolio")]
    public async Task Bulk_membership_with_foreign_ids_changes_nothing_for_either_owner()
    {
        var (a, b) = api.Owners();
        var aPortfolio = await a.Portfolio(Isolated.Marker("portfolio-a"));
        var aAccount = await a.ManualAccount(Isolated.Marker("account-a"), aPortfolio);
        var aId = aAccount.GetProperty("id").GetGuid();
        var aRevision = aAccount.GetProperty("settingsRevision").GetInt64();
        var bPortfolio = await b.Portfolio(Isolated.Marker("portfolio-b"));
        var bAccount = await b.ManualAccount(Isolated.Marker("account-b"));
        var bId = bAccount.GetProperty("id").GetGuid();
        var bRevision = bAccount.GetProperty("settingsRevision").GetInt64();
        // Positive control: each owner moves its own account with a matching expected revision.
        var aOther = (await a.ManualAccount(Isolated.Marker("account-a2"))).GetProperty("id").GetGuid();
        var moved = await a.Post("/api/accounts/portfolio", new MoveAccountsRequest([aOther], aPortfolio));
        Assert.Equal(aPortfolio, Assert.Single(moved.EnumerateArray()).GetProperty("portfolioId").GetGuid());
        var aPaths = new[] { "/api/accounts", "/api/portfolios", $"/api/portfolios/{aPortfolio}" };
        var bPaths = new[] { "/api/accounts", "/api/portfolios", $"/api/portfolios/{bPortfolio}" };
        var aBefore = await Isolated.State(a, aPaths);
        var bBefore = await Isolated.State(b, bPaths);

        // A foreign account mixed with an owned one: all or nothing, like an unknown ID.
        await Isolated.SameAsUnknown(b, aId, Isolated.Request(HttpMethod.Post, _ => "/api/accounts/portfolio",
            id => new MoveAccountsRequest([bId, id], bPortfolio)));
        await Isolated.SameAsUnknown(b, aId, Isolated.Request(HttpMethod.Post, _ => "/api/accounts/portfolio",
            id => new MoveAccountsRequest([bId, id], bPortfolio, [new(bId, bRevision), new(id, aRevision)])));
        // Unlinking (null portfolio) a foreign account.
        await Isolated.SameAsUnknown(b, aId, Isolated.Request(HttpMethod.Post, _ => "/api/accounts/portfolio",
            id => new MoveAccountsRequest([id], null)));
        // An owned account moved into a foreign portfolio.
        await Isolated.SameAsUnknown(b, aPortfolio, Isolated.Request(HttpMethod.Post, _ => "/api/accounts/portfolio",
            id => new MoveAccountsRequest([bId], id, [new(bId, bRevision)])));
        // A foreign account only named in the expected revisions.
        await Isolated.SameAsUnknown(b, aId, Isolated.Request(HttpMethod.Post, _ => "/api/accounts/portfolio",
            id => new MoveAccountsRequest([bId], bPortfolio, [new(bId, bRevision), new(id, aRevision)])));
        // Create-with-accounts naming a foreign account creates no portfolio.
        await Isolated.SameAsUnknown(b, aId, Isolated.Request(HttpMethod.Post, _ => "/api/portfolios",
            id => new CreatePortfolioRequest(Isolated.Marker("with-foreign"), null, [bId, id])));
        await Isolated.SameAsUnknown(b, aId, Isolated.Request(HttpMethod.Post, _ => "/api/portfolios",
            id => new CreatePortfolioRequest(Isolated.Marker("with-foreign-expected"), null, [bId], [new(bId, bRevision), new(id, aRevision)])));

        Assert.Equal(aBefore, await Isolated.State(a, aPaths));
        Assert.Equal(bBefore, await Isolated.State(b, bPaths));
        // The owned account still moves with its unchanged revision: no partial change consumed it.
        var final = await b.Post("/api/accounts/portfolio", new MoveAccountsRequest([bId], bPortfolio, [new(bId, bRevision)]));
        Assert.Equal(bPortfolio, Assert.Single(final.EnumerateArray()).GetProperty("portfolioId").GetGuid());
        Assert.Equal(aBefore, await Isolated.State(a, aPaths));
    }

    [PostgresFact]
    [Covers("GET", "/api/accounts/{id:guid}/credential")]
    [Covers("PUT", "/api/accounts/{id:guid}/credential")]
    [Covers("DELETE", "/api/accounts/{id:guid}/credential")]
    public async Task Credential_metadata_of_another_owner_answers_like_an_unknown_account()
    {
        var (a, b) = api.Owners();
        var account = (await a.IndexAccount(Isolated.Marker("index-a"))).GetProperty("id").GetGuid();
        var saved = await a.Send(HttpMethod.Put, $"/api/accounts/{account}/credential", new { token = SecurityFixture.Token });
        Assert.Equal("valid", saved.GetProperty("credential").GetProperty("status").GetString());
        var path = $"/api/accounts/{account}/credential";
        var before = await Isolated.State(a, path, $"/api/accounts/{account}");

        await Isolated.NotFound(b, account, Isolated.Request(HttpMethod.Get, id => $"/api/accounts/{id}/credential"));
        await Isolated.NotFound(b, account, Isolated.Request(HttpMethod.Put, id => $"/api/accounts/{id}/credential",
            _ => new { token = SecurityFixture.Token }));
        await Isolated.NotFound(b, account, Isolated.Request(HttpMethod.Delete, id => $"/api/accounts/{id}/credential"));
        Assert.Equal(before, await Isolated.State(a, path, $"/api/accounts/{account}"));

        // B's own account on the same index stores its own credential; A's stays.
        var own = (await b.IndexAccount(Isolated.Marker("index-b"))).GetProperty("id").GetGuid();
        Assert.Equal(JsonValueKind.Null, (await b.GetJson($"/api/accounts/{own}/credential")).GetProperty("credential").ValueKind);
        await b.Send(HttpMethod.Put, $"/api/accounts/{own}/credential", new { token = SecurityFixture.Token });
        await b.Send(HttpMethod.Delete, $"/api/accounts/{own}/credential", expected: HttpStatusCode.NoContent);
        Assert.Equal(before, await Isolated.State(a, path, $"/api/accounts/{account}"));
    }

    [PostgresFact]
    [Covers("GET", "/api/venues/{venueId}/accounts")]
    [Covers("POST", "/api/venues/{venueId}/accounts/credential")]
    public async Task Discovery_marks_only_the_callers_imports_of_a_shared_source()
    {
        var (a, b) = api.Owners();
        var account = (await a.IndexAccount(Isolated.Marker("index-a"))).GetProperty("id").GetGuid();
        var venue = SecurityFixture.Venue.Id;
        var query = $"/api/venues/{venue}/accounts?address={IsolationVenues.Address}";
        var aFound = await a.GetJson(query);
        Assert.Equal(account, Candidate(aFound, IsolationVenues.Index).GetProperty("existingAccountId").GetGuid());
        foreach (var found in new[] { await b.GetJson(query),
            await b.Post($"/api/venues/{venue}/accounts/credential", new { address = IsolationVenues.Address, token = SecurityFixture.Token }) })
        {
            Assert.Equal(JsonValueKind.Null, Candidate(found, IsolationVenues.Index).GetProperty("existingAccountId").ValueKind);
            Isolated.NoLeak(found.GetRawText(), account);
        }
        // The same native index imports for B as a separate account.
        var own = (await b.IndexAccount(Isolated.Marker("index-b"))).GetProperty("id").GetGuid();
        Assert.NotEqual(account, own);
        Assert.Equal(own, Candidate(await b.GetJson(query), IsolationVenues.Index).GetProperty("existingAccountId").GetGuid());
        Assert.Equal(account, Candidate(await a.GetJson(query), IsolationVenues.Index).GetProperty("existingAccountId").GetGuid());
    }

    private static JsonElement Candidate(JsonElement discovery, string source) =>
        discovery.GetProperty("accounts").EnumerateArray().Single(c => c.GetProperty("sourceId").GetString() == source);

    [PostgresFact]
    [Covers("GET", "/api/accounts/{id:guid}/snapshot")]
    [Covers("GET", "/api/accounts/{id:guid}/fills")]
    [Covers("GET", "/api/accounts/{id:guid}/instruments")]
    [Covers("GET", "/api/accounts/{id:guid}/candles")]
    [Covers("GET", "/api/accounts/{id:guid}/market-context")]
    [Covers("GET", "/api/accounts/{id:guid}/market-stream")]
    [Covers("POST", "/api/accounts/{id:guid}/sync")]
    public async Task Account_reads_and_refresh_of_another_owner_answer_like_unknown_ones()
    {
        var (a, b) = api.Owners();
        var synced = await a.SyncedVenueAccount(Isolated.Marker("venue-a"));
        var account = synced.GetProperty("id").GetGuid();
        Assert.Equal("synced", synced.GetProperty("syncStatus").GetString());
        // Positive controls for every read.
        Assert.NotEqual(JsonValueKind.Null, (await a.GetJson($"/api/accounts/{account}/snapshot")).ValueKind);
        Assert.NotEmpty((await a.GetJson($"/api/accounts/{account}/fills")).EnumerateArray());
        await a.GetJson($"/api/accounts/{account}/instruments");
        await a.GetJson($"/api/accounts/{account}/candles?instrument=BTC&interval=1h");
        await a.GetJson($"/api/accounts/{account}/market-context?instrument=BTC");
        var reads = api.Venues.Reader.Fixture.Reads;
        var orderReads = api.Venues.Orders.Reads;
        var before = await Isolated.State(a, $"/api/accounts/{account}", $"/api/accounts/{account}/snapshot", $"/api/accounts/{account}/fills");

        foreach (var path in new Func<Guid, string>[]
        {
            id => $"/api/accounts/{id}/snapshot",
            id => $"/api/accounts/{id}/fills",
            id => $"/api/accounts/{id}/instruments",
            id => $"/api/accounts/{id}/candles?instrument=BTC&interval=1h",
            id => $"/api/accounts/{id}/market-context?instrument=BTC",
            id => $"/api/accounts/{id}/market-stream?instrument=BTC&interval=1h"
        })
            await Isolated.NotFound(b, account, Isolated.Request(HttpMethod.Get, path));
        // A refresh of a foreign account answers like an unknown one and never reads the venue for it.
        await Isolated.SameAsUnknown(b, account, Isolated.Request(HttpMethod.Post, id => $"/api/accounts/{id}/sync"));
        Assert.Equal((reads, orderReads), (api.Venues.Reader.Fixture.Reads, api.Venues.Orders.Reads));
        Assert.Equal(before, await Isolated.State(a, $"/api/accounts/{account}", $"/api/accounts/{account}/snapshot", $"/api/accounts/{account}/fills"));
    }

    [PostgresFact]
    public async Task Sealed_credential_copied_to_another_owners_account_cannot_be_opened()
    {
        var (a, b) = api.Owners();
        var aAccount = (await a.IndexAccount(Isolated.Marker("index-a"))).GetProperty("id").GetGuid();
        var bAccount = (await b.IndexAccount(Isolated.Marker("index-b"))).GetProperty("id").GetGuid();
        await a.Send(HttpMethod.Put, $"/api/accounts/{aAccount}/credential", new { token = SecurityFixture.Token });
        Domain.Credentials.AccountCredential original;
        await using (var aDb = api.Database.Context(a.Id))
            original = await aDb.AccountCredentials.SingleAsync();
        Assert.Equal(SecurityFixture.Token, api.Vault.Open(a.Id, aAccount, original.Purpose, original.Sealed()));

        // Copy the sealed bytes onto B's account, as a restore or a database edit could.
        await using (var bDb = api.Database.Context(b.Id))
        {
            bDb.AccountCredentials.Add(new()
            {
                OwnerId = b.Id, AccountId = bAccount, Purpose = original.Purpose, KeyId = original.KeyId,
                Nonce = original.Nonce, Ciphertext = original.Ciphertext, Tag = original.Tag, Scope = original.Scope,
                ExpiresAt = original.ExpiresAt, CreatedAt = original.CreatedAt, LastVerifiedAt = original.LastVerifiedAt
            });
            await bDb.SaveChangesAsync();
        }
        // The associated data binds owner, account and purpose: every rebinding fails to open.
        Assert.Throws<CredentialStorageException>(() => api.Vault.Open(b.Id, bAccount, original.Purpose, original.Sealed()));
        Assert.Throws<CredentialStorageException>(() => api.Vault.Open(b.Id, aAccount, original.Purpose, original.Sealed()));
        Assert.Throws<CredentialStorageException>(() => api.Vault.Open(a.Id, bAccount, original.Purpose, original.Sealed()));
        // Through the API, B's copied row is unusable and A's own is untouched.
        var copied = await b.GetJson($"/api/accounts/{bAccount}/credential");
        Assert.Equal("unavailable", copied.GetProperty("credential").GetProperty("status").GetString());
        Assert.Equal("valid", (await a.GetJson($"/api/accounts/{aAccount}/credential")).GetProperty("credential").GetProperty("status").GetString());
    }
}

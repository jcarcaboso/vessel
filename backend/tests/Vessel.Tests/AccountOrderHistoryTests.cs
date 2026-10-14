using Vessel.Application.Common;
using Vessel.Application.Credentials;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;
using Vessel.Infrastructure.Venues.Hyperliquid;
using Vessel.Infrastructure.Venues.Lighter;
using Vessel.Infrastructure.Venues.Risex;

namespace Vessel.Tests;

public sealed class AccountOrderHistoryTests
{
    private sealed class RetentionStore : IPlayExecutionStore
    {
        public IReadOnlyList<VenueOrder> Orders { get; private set; } = [];
        public Account? Account { get; private set; }
        public int Locks { get; private set; }
        public int Writes { get; private set; }
        public Task<T> WithAccountLockAsync<T>(Guid accountId, Func<Task<T>> action, CancellationToken ct)
        {
            Locks++;
            return action();
        }
        public Task UpsertOrdersAsync(Account account, IReadOnlyList<VenueOrder> orders, DateTimeOffset observedAt, CancellationToken ct)
        {
            Assert.Equal(1, Locks);
            Account = account; Orders = orders; Writes++;
            return Task.CompletedTask;
        }
        // Retention must not read active Plays, match/link orders or change fill facts.
        public Task<Account?> AccountAsync(Guid id, CancellationToken ct) => throw new NotSupportedException();
        public Task<List<Play>> ActivePlaysAsync(Guid accountId, CancellationToken ct) => throw new NotSupportedException();
        public Task<List<ImportedOrder>> OrdersAsync(Guid accountId, CancellationToken ct) => throw new NotSupportedException();
        public Task<List<PlayOrderLink>> LinksAsync(Guid accountId, CancellationToken ct) => throw new NotSupportedException();
        public Task<List<ImportedFill>> FillsAsync(Guid accountId, IReadOnlyCollection<string> orderIds, CancellationToken ct) => throw new NotSupportedException();
        public void Add(PlayOrderLink link) => throw new NotSupportedException();
        public void Add(PlayStatusChange change) => throw new NotSupportedException();
        public Task SaveAsync(CancellationToken ct) => throw new NotSupportedException();
    }

    private static (PlayExecutionService Service, Account Account, RetentionStore Store) Harness(
        AccountHistoryOrders orders, IAccountCredentialReader? credentials = null, bool enabled = true,
        bool foreign = false, bool supportsOrders = true, bool readerAvailable = true, bool hasSource = true)
    {
        var owner = Guid.NewGuid();
        var accounts = new MemoryWorkspaceStore(owner);
        var account = new Account(Guid.NewGuid(), foreign ? Guid.NewGuid() : owner, orders.VenueId, "History");
        account.Configure(null, null, null, hasSource ? "42" : null);
        if (!enabled) account.UpdateSettings(account.Name, null, false);
        accounts.Accounts.Add(account);
        var descriptor = AccountHistoryOrders.Descriptor(orders.VenueId);
        var venues = new VenueRegistry([descriptor with { Capabilities = descriptor.Capabilities with { Orders = supportsOrders } }],
            [], readerAvailable ? [orders] : [], [], [], [], [], []);
        var store = new RetentionStore();
        var workspace = new WorkspaceService(accounts, new CoreOwner(owner), venues);
        return (new(null!, store, workspace, venues, TimeProvider.System, credentials), account, store);
    }

    [Fact]
    public async Task Retains_old_orders_for_every_instrument_without_active_plays_or_matching()
    {
        var orders = new AccountHistoryOrders();
        orders.Result = orders.Result with { Orders = [..orders.Result.Orders,
            orders.Result.Orders[0] with { OrderId = "other-instrument", ContractId = "ETH", Status = VenueOrderStatus.Rejected }] };
        var (service, account, store) = Harness(orders);
        var notice = await service.RetainAccountOrdersAsync(account.Id, default);
        Assert.Equal(orders.Result.Notice, notice);
        Assert.Equal(1, orders.Reads);
        Assert.Same(account, orders.Account);
        Assert.Same(account, store.Account);
        Assert.Equal(orders.Result.Orders, store.Orders);
        Assert.Equal(1, store.Writes);
        Assert.Null(account.LastSyncedAtUtc);
    }

    [Theory]
    [InlineData("http")]
    [InlineData("timeout")]
    [InlineData("adapter")]
    [InlineData("invalid-side")]
    public async Task Optional_failure_is_a_safe_notice_and_never_partially_retains_orders(string failure)
    {
        var orders = new AccountHistoryOrders();
        orders.Failure = failure switch
        {
            "http" => new HttpRequestException("ro:synthetic-secret provider response"),
            "timeout" => new OperationCanceledException("ro:synthetic-secret"),
            "adapter" => new VenueReadException("ro:synthetic-secret"),
            _ => null
        };
        if (failure == "invalid-side")
            orders.Result = orders.Result with { Orders = [orders.Result.Orders[0], orders.Result.Orders[1] with { Side = "B" }] };
        var (service, account, store) = Harness(orders);
        var notice = await service.RetainAccountOrdersAsync(account.Id, default);
        Assert.Contains("Order history could not be refreshed", notice);
        Assert.DoesNotContain("ro:", notice);
        Assert.Equal(0, store.Locks);
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public async Task Caller_cancellation_propagates_before_retention_even_if_reader_returns()
    {
        using var cancelled = new CancellationTokenSource();
        var orders = new AccountHistoryOrders { AfterRead = cancelled.Cancel };
        var (service, account, store) = Harness(orders);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.RetainAccountOrdersAsync(account.Id, cancelled.Token));
        Assert.Equal(1, orders.Reads);
        Assert.Equal(0, store.Writes);
        Assert.Equal(0, store.Locks);
    }

    [Fact]
    public async Task Already_cancelled_request_does_not_read_the_venue()
    {
        var orders = new AccountHistoryOrders();
        var (service, account, store) = Harness(orders);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.RetainAccountOrdersAsync(account.Id, new(true)));
        Assert.Equal(0, orders.Reads);
        Assert.Equal(0, store.Writes);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Lighter_missing_or_unusable_credential_skips_order_read(bool readerRegistered)
    {
        var orders = new AccountHistoryOrders("lighter");
        var credential = readerRegistered ? new AccountHistoryCredential(null) : null;
        var (service, account, store) = Harness(orders, credential);
        var notice = await service.RetainAccountOrdersAsync(account.Id, default);
        Assert.Contains("read-only token", notice);
        Assert.Equal(0, orders.Reads);
        Assert.Equal(0, store.Writes);
        if (credential is not null) Assert.Equal(account.Id, credential.AccountId);
    }

    [Fact]
    public async Task Lighter_usable_credential_uses_account_aware_order_reader()
    {
        var orders = new AccountHistoryOrders("lighter");
        var (service, account, store) = Harness(orders, new AccountHistoryCredential("ro:synthetic-only"));
        await service.RetainAccountOrdersAsync(account.Id, default);
        Assert.Same(account, orders.Account);
        Assert.Equal(1, orders.Reads);
        Assert.Equal(1, store.Writes);
    }

    [Fact]
    public async Task Cancellation_during_credential_lookup_propagates_without_order_reads()
    {
        using var cancelled = new CancellationTokenSource();
        var orders = new AccountHistoryOrders("lighter");
        var credential = new AccountHistoryCredential(null) { AfterRead = cancelled.Cancel };
        var (service, account, store) = Harness(orders, credential);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.RetainAccountOrdersAsync(account.Id, cancelled.Token));
        Assert.Equal(0, orders.Reads);
        Assert.Equal(0, store.Writes);
    }

    [Theory]
    [InlineData(false, true, 400)]
    [InlineData(true, false, 404)]
    public async Task Disabled_or_foreign_account_does_not_read_credentials_or_orders(bool enabled, bool owned, int status)
    {
        var orders = new AccountHistoryOrders("lighter");
        var credential = new AccountHistoryCredential("ro:synthetic-only");
        var (service, account, store) = Harness(orders, credential, enabled, !owned);
        var error = await Assert.ThrowsAsync<ProblemException>(() => service.RetainAccountOrdersAsync(account.Id, default));
        Assert.Equal(status, error.StatusCode);
        Assert.Null(credential.AccountId);
        Assert.Equal(0, orders.Reads);
        Assert.Equal(0, store.Writes);
    }

    [Theory]
    [InlineData(false, true, "does not provide")]
    [InlineData(true, false, "unavailable")]
    public async Task Descriptor_capability_and_missing_reader_return_notices_without_reads(bool supportsOrders, bool available, string message)
    {
        var orders = new AccountHistoryOrders();
        var (service, account, store) = Harness(orders, supportsOrders: supportsOrders, readerAvailable: available);
        Assert.Contains(message, await service.RetainAccountOrdersAsync(account.Id, default));
        Assert.Equal(0, orders.Reads);
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public async Task Missing_source_is_rejected_before_reading()
    {
        var orders = new AccountHistoryOrders();
        var (service, account, store) = Harness(orders, hasSource: false);
        Assert.Equal(400, (await Assert.ThrowsAsync<ProblemException>(() => service.RetainAccountOrdersAsync(account.Id, default))).StatusCode);
        Assert.Equal(0, orders.Reads);
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public void Order_notice_replacement_keeps_latest_public_coverage_and_failure_state_without_growth()
    {
        var account = new Account(Guid.NewGuid(), Guid.NewGuid(), "hyperliquid", "History");
        account.RecordSync(AccountHistoryOrders.At, "Previous public coverage.");
        account.RecordOrderHistoryNotice("Previous order coverage.");
        account.RecordSync(AccountHistoryOrders.At.AddMinutes(1), "Latest public coverage.");
        Assert.Contains("Previous order coverage.", account.HistoryNotice);
        account.RecordSyncFailure();
        var state = (account.SyncStatus, account.LastSyncError, account.LastSyncedAtUtc, account.SettingsRevision);
        account.RecordOrderHistoryNotice("Latest order coverage.");
        var expected = account.HistoryNotice;
        for (var refresh = 0; refresh < 5; refresh++)
        {
            account.RecordOrderHistoryNotice("Latest order coverage.");
            Assert.Equal(expected, account.HistoryNotice);
            Assert.Equal(state, (account.SyncStatus, account.LastSyncError, account.LastSyncedAtUtc, account.SettingsRevision));
        }
        Assert.Contains("Latest public coverage.", account.HistoryNotice);
        Assert.DoesNotContain("Previous", account.HistoryNotice);
        account.RecordOrderHistoryNotice(null);
        Assert.Equal("Latest public coverage.", account.HistoryNotice);
        Assert.Equal(state, (account.SyncStatus, account.LastSyncError, account.LastSyncedAtUtc, account.SettingsRevision));
    }

    [Fact]
    public async Task Retention_persists_notice_without_resetting_account_sync_or_settings_state()
    {
        var orders = new AccountHistoryOrders();
        var (service, account, _) = Harness(orders);
        account.RecordSync(AccountHistoryOrders.At, "Retained public coverage.");
        account.RecordSyncFailure();
        var state = (account.SyncStatus, account.LastSyncError, account.LastSyncedAtUtc, account.SettingsRevision);
        await service.RetainAccountOrdersAsync(account.Id, default);
        Assert.Contains(orders.Result.Notice, account.HistoryNotice);
        Assert.Contains("Retained public coverage.", account.HistoryNotice);
        Assert.Equal(state, (account.SyncStatus, account.LastSyncError, account.LastSyncedAtUtc, account.SettingsRevision));
    }

    [Theory]
    [InlineData("hyperliquid", 516)]
    [InlineData("risex", 340)]
    [InlineData("lighter", 902)]
    public async Task Optional_failure_notice_fits_with_each_venues_maximum_public_coverage(string venue, int combinedLength)
    {
        var coverage = AccountHistoryNoticeBudget.CombinedCases().Where(c => c.Venue == venue).MaxBy(c => c.Public.Length);
        var orders = new AccountHistoryOrders(venue) { Failure = new HttpRequestException("synthetic optional failure") };
        var (service, account, _) = Harness(orders, new AccountHistoryCredential("ro:synthetic-only"));
        account.RecordSync(AccountHistoryOrders.At, coverage.Public);
        account.RecordOrderHistoryNotice(coverage.Orders);
        var notice = await service.RetainAccountOrdersAsync(account.Id, default);
        Assert.Equal(coverage.Public + "\nOrder history: " + notice, account.HistoryNotice);
        Assert.Equal(combinedLength, account.HistoryNotice!.Length);
        Assert.True(account.HistoryNotice.Length <= 1000);
    }
}

internal sealed class AccountHistoryOrders(string venueId = "hyperliquid") : IVenueOrderReader
{
    internal static readonly DateTimeOffset At = DateTimeOffset.Parse("2026-09-01T10:00:00Z");
    public string VenueId => venueId;
    public int Reads { get; private set; }
    public Account? Account { get; private set; }
    public Exception? Failure { get; set; }
    public Action? AfterRead { get; set; }
    public Func<CancellationToken, Task>? WaitForRead { get; set; }
    public VenueOrderReadResult Result { get; set; } = new(
        [Order("entry", "buy", false), Order("exit", "sell", true)], At.AddDays(1), "Bounded recent order history only; no full-history backfill.");
    private static VenueOrder Order(string id, string side, bool reduceOnly) =>
        new(id, "BTC", side, "limit", reduceOnly ? 110 : 100, null, reduceOnly, false, 1, 0,
            At.AddSeconds(reduceOnly ? 59 : -1), VenueOrderStatus.Filled, "filled", At.AddSeconds(reduceOnly ? 60 : 0), "BTC");
    public Task<VenueOrderReadResult> ReadOrdersAsync(string source, CancellationToken ct) => throw new NotSupportedException("Use account-aware reads.");
    public async Task<VenueOrderReadResult> ReadOrdersAsync(Account account, CancellationToken ct)
    {
        Reads++; Account = account; ct.ThrowIfCancellationRequested(); AfterRead?.Invoke();
        if (WaitForRead is not null) await WaitForRead(ct);
        if (Failure is not null) throw Failure;
        return Result;
    }
    internal static VenueDescriptor Descriptor(string venue) => venue switch
    {
        "lighter" => LighterReader.Descriptor,
        "risex" => RisexReader.Descriptor,
        _ => HyperliquidPerpetualReader.Descriptor
    };
    internal static VenueRegistry Registry(FixtureReader reader, AccountHistoryOrders orders) =>
        new([VenueDescriptor.Manual, Descriptor(reader.VenueId)], [reader], [orders], [], [], [], [], []);
    internal static FixtureReader PublicReader(string venue = "hyperliquid")
    {
        var reader = new FixtureReader { VenueId = venue };
        reader.Result = reader.Result with
        {
            Snapshot = new(At.AddDays(1), "synthetic-perpetuals", 1000, 900, 0, []),
            Fills =
            [
                new("entry-fill", "BTC", "buy", "Open Long", 100, 1, 0, "USDC", 0, At, "entry", "", "{}", ExecutionFacts.Open, VenueContractId: "BTC"),
                new("exit-fill", "BTC", "sell", "Close Long", 110, 1, 0, "USDC", 10, At.AddSeconds(60), "exit", "", "{}", ExecutionFacts.Close, VenueContractId: "BTC")
            ],
            HistoryNotice = "Bounded recent public fills only."
        };
        return reader;
    }
}

internal sealed class AccountHistoryCredential(string? token) : IAccountCredentialReader
{
    public string? Token { get; set; } = token;
    public Guid? AccountId { get; private set; }
    public Action? AfterRead { get; set; }
    public Task<string?> ReadAsync(Guid accountId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested(); AccountId = accountId; AfterRead?.Invoke();
        return Task.FromResult(Token);
    }
    public Task MarkRefusedAsync(Guid accountId, CancellationToken ct) => throw new NotSupportedException();
}

internal static class AccountHistoryNoticeBudget
{
    public static string LighterCappedOrders => LighterReader.OrdersNotice + LighterReader.OrdersPageLimitNotice;

    public static string LighterPublic(string credentialNotice, string terminalNotice, int missingPnl = 500, int fees = 500, int selfTrades = 500) =>
        string.Join(" ", new[] { LighterReader.HistoryNotice, credentialNotice, terminalNotice,
            LighterReader.MissingPnlNotice(missingPnl), LighterReader.FeeNotice(fees), LighterReader.SelfTradeNotice(selfTrades) }
            .Where(text => !string.IsNullOrEmpty(text)));

    public static IEnumerable<(string Venue, string Public, string Orders)> CombinedCases()
    {
        // A refused bind clears the token, so it cannot also cause an authenticated-page retry.
        // A failed page clears the cursor, so unavailable history and the page cap cannot coexist.
        // Counters share at most 500 rows; use the maximum three-digit width for each conservatively.
        foreach (var credential in new[] { "", LighterReader.CredentialRefusedNotice, LighterReader.HistoryRetryNotice })
        foreach (var terminal in new[] { "", LighterReader.PageLimitNotice, LighterReader.HistoryUnavailableNotice })
            yield return ("lighter", LighterPublic(credential, terminal), LighterCappedOrders);
        yield return ("lighter", string.Join(" ", LighterReader.HistoryNotice, LighterReader.NonzeroRateNotice), LighterCappedOrders);
        yield return ("hyperliquid", Literal(typeof(HyperliquidPerpetualReader), "HistoryNotice"), Literal(typeof(HyperliquidPerpetualReader), "OrdersNotice"));
        yield return ("risex", Literal(typeof(RisexReader), "HistoryNotice"), Literal(typeof(RisexReader), "OrdersNotice"));
    }

    private static string Literal(Type type, string name) => (string)type.GetField(name,
        System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!.GetRawConstantValue()!;
}

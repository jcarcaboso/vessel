using System.Globalization;
using Vessel.Application.Ownership;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Workspace;

public sealed class WorkspaceService(IWorkspaceStore store, IJournalOwnerContext owner, IVenueRegistry venues)
{
    private static string? Money(decimal? value) => value?.ToString("0.############################", CultureInfo.InvariantCulture);
    private static void ValidateName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 200)
            throw new WorkspaceException(400, "Name is required and must be at most 200 characters.");
    }

    public async Task<PortfolioDto> CreatePortfolioAsync(CreatePortfolioRequest request, CancellationToken ct)
    {
        ValidateName(request.Name);
        var portfolio = new Portfolio(Guid.NewGuid(), owner.OwnerId, request.Name);
        await store.AddPortfolioAsync(portfolio, ct);
        return new(portfolio.Id, portfolio.Name, 0, null, "unavailable");
    }

    public async Task<AccountDto> CreateAccountAsync(CreateAccountRequest request, CancellationToken ct)
    {
        ValidateName(request.Name);
        var descriptor = venues.Descriptor(request.VenueId)
            ?? throw new WorkspaceException(400, $"Choose {OrList(venues.Descriptors.Select(d => d.Id))}.");

        if (request.PortfolioId == Guid.Empty) throw new WorkspaceException(404, "Portfolio not found.");
        decimal? value = null;
        if (descriptor.Id == VenueDescriptor.ManualId)
        {
            if (request.Address is not null) throw new WorkspaceException(400, "Manual accounts do not use a public address.");
            if (request.ManualAccountValueUsd is { } text)
            {
                if (!TryExactNonnegativeDecimal(text, out var parsed))
                    throw new WorkspaceException(400, "Manual account value must be an exact nonnegative decimal string.");
                value = parsed;
            }
        }
        else
        {
            if (request.ManualAccountValueUsd is not null) throw new WorkspaceException(400, "Venue balances cannot be supplied manually.");
            if (descriptor.Source == VenueSources.EvmAddress &&
                (request.Address is not { Length: 42 } address || !address.StartsWith("0x", StringComparison.Ordinal) ||
                !address.AsSpan(2).ContainsOnlyHex()))
                throw new WorkspaceException(400, $"{descriptor.Name} requires a 42-character public hexadecimal address.");
        }
        var account = new Account(Guid.NewGuid(), owner.OwnerId, request.VenueId, request.Name);
        account.Configure(request.PortfolioId, request.Address?.ToLowerInvariant(), value);
        await store.WithManagementLockAsync(async () =>
        {
            await ValidatePortfolio(request.PortfolioId, ct);
            if (account.Address is { } address && await store.SourceExistsAsync(account.VenueId, address, ct))
                throw new WorkspaceException(409, "An account for this venue and address already exists. Manage or re-enable that account.");
            await store.AddAccountAsync(account, ct);
            return true;
        }, ct);
        return ToDto(account, null);
    }

    private async Task ValidatePortfolio(Guid? id, CancellationToken ct)
    {
        if (id.HasValue && !(await store.PortfoliosAsync(ct)).Any(p => p.Id == id))
            throw new WorkspaceException(404, "Portfolio not found.");
    }

    public async Task<PortfolioDto> RenamePortfolioAsync(Guid id, RenamePortfolioRequest request, CancellationToken ct)
    {
        ValidateName(request.Name);
        await store.WithManagementLockAsync(async () =>
        {
            var portfolio = (await store.PortfoliosAsync(ct)).SingleOrDefault(p => p.Id == id)
                ?? throw new WorkspaceException(404, "Portfolio not found.");
            portfolio.Rename(request.Name);
            await store.SaveAsync(ct);
            return true;
        }, ct);
        return await PortfolioAsync(id, ct);
    }

    public async Task DeletePortfolioAsync(Guid id, CancellationToken ct) =>
        await store.WithManagementLockAsync(async () =>
        {
            await store.DeletePortfolioAsync(id, ct);
            return true;
        }, ct);

    public async Task<AccountDto> UpdateAccountAsync(Guid id, UpdateAccountRequest request, CancellationToken ct)
    {
        ValidateName(request.Name);
        return await store.WithManagementLockAsync(() => store.WithAccountLockAsync(id, async account =>
        {
            if (request.ExpectedRevision != account.SettingsRevision)
                throw new WorkspaceException(409, "Account settings changed. Reload the current settings before saving.");
            await ValidatePortfolio(request.PortfolioId, ct);
            account.UpdateSettings(request.Name, request.PortfolioId, request.IsEnabled);
            await store.SaveAsync(ct);
            return ToDto(account, await store.SnapshotAsync(id, ct));
        }, ct), ct);
    }

    public async Task DeleteAccountAsync(Guid id, CancellationToken ct) =>
        await store.WithManagementLockAsync(() => store.WithAccountLockAsync(id, async account =>
        {
            await store.DeleteAccountAsync(account, ct);
            return true;
        }, ct), ct);

    // decimal.TryParse alone rounds over-precision input. Round-trip the digits to reject loss.
    public static bool TryExactNonnegativeDecimal(string text, out decimal value)
    {
        value = 0;
        if (text.Length is 0 or > 100 || text.Any(c => c is not (>= '0' and <= '9') and not '.') ||
            text.Count(c => c == '.') > 1 || !decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value)) return false;
        static string Normalize(string s)
        {
            var parts = s.Split('.');
            var whole = parts[0].TrimStart('0');
            var fraction = parts.Length == 2 ? parts[1].TrimEnd('0') : "";
            return (whole.Length == 0 ? "0" : whole) + (fraction.Length == 0 ? "" : "." + fraction);
        }
        return Normalize(text) == Normalize(value.ToString(CultureInfo.InvariantCulture));
    }

    public async Task<IReadOnlyList<AccountDto>> AccountsAsync(CancellationToken ct)
    {
        var accounts = await store.AccountsAsync(ct);
        var snapshots = (await store.SnapshotsAsync(ct)).ToDictionary(s => s.AccountId);
        return accounts.Select(a => ToDto(a, snapshots.GetValueOrDefault(a.Id))).ToList();
    }

    public async Task<IReadOnlyList<PortfolioDto>> PortfoliosAsync(CancellationToken ct) =>
        MapPortfolios(await store.PortfoliosAsync(ct), await store.AccountsAsync(ct),
            (await store.SnapshotsAsync(ct)).ToDictionary(s => s.AccountId));

    private static List<PortfolioDto> MapPortfolios(IReadOnlyList<Portfolio> portfolios, IReadOnlyList<Account> accounts,
        IReadOnlyDictionary<Guid, AccountSnapshot> snapshots)
    {
        decimal? Value(Account a) => a.VenueId == "manual" ? a.ManualAccountValueUsd : snapshots.GetValueOrDefault(a.Id)?.AccountValueUsd;
        return portfolios.Select(p =>
        {
            var members = accounts.Where(a => a.PortfolioId == p.Id).ToList();
            var enabledMembers = members.Where(a => a.IsEnabled).ToList();
            var values = enabledMembers.Select(Value).Where(v => v.HasValue).ToList();
            var balances = enabledMembers.Select(a => Balance(a, snapshots.GetValueOrDefault(a.Id))).Where(v => v.HasValue).ToList();
            return new PortfolioDto(p.Id, p.Name, members.Count, values.Count == 0 ? null : StablecoinTotals.Sum(values.Select(v => v!.Value)),
                values.Count == 0 ? "unavailable" : values.Count == enabledMembers.Count ? "complete" : "partial",
                balances.Count == 0 ? null : StablecoinTotals.Sum(balances.Select(v => v!.Value)),
                balances.Count == 0 ? "unavailable" : balances.Count == enabledMembers.Count ? "complete" : "partial");
        }).ToList();
    }

    public async Task<OverviewDto> OverviewAsync(CancellationToken ct)
    {
        var accounts = await store.AccountsAsync(ct);
        var snapshots = (await store.SnapshotsAsync(ct)).ToDictionary(s => s.AccountId);
        var dtos = accounts.Select(a => ToDto(a, snapshots.GetValueOrDefault(a.Id))).ToList();
        decimal? Value(Account a) => a.VenueId == "manual" ? a.ManualAccountValueUsd : snapshots.GetValueOrDefault(a.Id)?.AccountValueUsd;
        var portfolios = MapPortfolios(await store.PortfoliosAsync(ct), accounts, snapshots);
        var known = accounts.Where(a => a.IsEnabled).Select(Value).Where(v => v.HasValue).ToList();
        var wallets = snapshots.Values.Where(s => s.StablecoinsObservedAtUtc.HasValue).ToList();
        return new(portfolios, dtos, new(portfolios.Count, accounts.Count, known.Count == 0 ? null : StablecoinTotals.Sum(known.Select(v => v!.Value)),
            known.Count, dtos.Sum(a => a.PositionCount), await store.FillCountAsync(ct),
            wallets.Count == 0 ? null : StablecoinTotals.Sum(wallets.SelectMany(s => s.Stablecoins).Select(b => b.Available)), wallets.Count),
            (await store.FillsAsync(null, 100, ct)).Select(ToDto).ToList(),
            "Known enabled-account values only. Primary perpetual margin and HyperCore stablecoin wallet are separate ledgers and are never summed as total equity. Stablecoin summaries are nominal at 1 per supported USD-pegged token; no FX, depeg, lending, EVM or risk adjustment is applied. Wallet available means total minus held, not guaranteed free perpetual margin or withdrawal. Imported fills are recent, not complete lifetime history.");
    }

    public async Task<SnapshotDto?> SnapshotAsync(Guid id, CancellationToken ct)
    {
        if (!(await RequireAccount(id, ct)).IsEnabled) return null;
        var s = await store.SnapshotAsync(id, ct);
        return s is null ? null : new(s.ObservedAtUtc, s.ValueScope, Money(s.AccountValueUsd), Money(s.WithdrawableUsd), Money(s.MarginUsedUsd),
            s.Positions.OrderBy(p => p.ContractId).Select(p => new PositionDto(p.ContractId, Money(p.SignedQuantity)!, Money(p.EntryPrice)!,
                Money(p.UnrealizedPnlUsd)!, Money(p.MarginUsedUsd)!, p.Leverage)).ToList(), WalletDto(s));
    }

    public async Task<PortfolioDto> PortfolioAsync(Guid id, CancellationToken ct) =>
        (await PortfoliosAsync(ct)).SingleOrDefault(p => p.Id == id) ??
        throw new WorkspaceException(404, "Portfolio not found.");

    public async Task<AccountDto> AccountAsync(Guid id, CancellationToken ct)
    {
        var account = await RequireAccount(id, ct);
        var snapshot = await store.SnapshotAsync(id, ct);
        return ToDto(account, snapshot);
    }

    public async Task<IReadOnlyList<FillDto>> FillsAsync(Guid id, CancellationToken ct)
    {
        if (!(await RequireAccount(id, ct)).IsEnabled) return [];
        return (await store.FillsAsync(id, 100, ct)).Select(ToDto).ToList();
    }

    public async Task<AccountInstrumentsDto> InstrumentsAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var account = await RequireAccount(id, ct);
        if (!account.IsEnabled)
            throw new WorkspaceException(409, "Enable the account before reading its instrument catalogue.");
        if (account.VenueId == "manual")
            return new(account.VenueId, "perpetuals", "manual", [],
                "Manual catalogue: enter a perpetual contract manually. No venue metadata is available.");
        if (venues.Reader(account.VenueId) is not { } reader)
            throw new WorkspaceException(502, "The venue instrument read failed. Try again later.");

        IReadOnlyList<VenueInstrument> instruments;
        try
        {
            instruments = await reader.ReadInstrumentsAsync(ct);
            ct.ThrowIfCancellationRequested();
        }
        catch (Exception ex) when (ex is VenueReadException or HttpRequestException ||
            ex is OperationCanceledException && !ct.IsCancellationRequested)
        {
            throw new WorkspaceException(502, "The venue instrument read failed. Try again later.");
        }
        return new(account.VenueId, "perpetuals", "primary-perpetual-dex", instruments,
            "Primary perpetual DEX metadata only. No orders, balances or execution refresh.");
    }

    public async Task<AccountDto> SyncAsync(Guid id, CancellationToken ct)
    {
        var failed = await store.WithAccountLockAsync(id, async account =>
        {
            if (!account.IsEnabled) throw new WorkspaceException(400, "Enable the account before refreshing it.");
            if (venues.Descriptor(account.VenueId) is not { Capabilities.Sync: true })
                throw new WorkspaceException(400, $"Only {OrList(venues.Descriptors.Where(d => d.Capabilities.Sync).Select(d => d.Name), "and")} accounts can be refreshed.");
            if (account.Address is null) throw new WorkspaceException(400, "A public address is required before refresh.");
            if (venues.Reader(account.VenueId) is not { } reader) throw new WorkspaceException(503, "Venue reader is unavailable.");
            PerpetualVenueReadResult result;
            try
            {
                result = await reader.ReadAsync(account.Address, ct);
                if (!result.Fills.All(VenueFactChecks.Valid))
                    throw new VenueReadException("The venue adapter returned fills outside Vessel's execution vocabulary.");
            }
            catch (Exception ex) when (ex is VenueReadException or HttpRequestException || ex is OperationCanceledException && !ct.IsCancellationRequested)
            {
                account.RecordSyncFailure();
                await store.SaveAsync(ct);
                return true;
            }
            await store.SaveRefreshAsync(account, result, ct);
            return false;
        }, ct);
        if (failed) throw new WorkspaceException(502, "The venue refresh failed. Try again later.");
        var updated = await RequireAccount(id, ct);
        return ToDto(updated, await store.SnapshotAsync(id, ct));
    }

    /// <summary>"a", "a or b", "a, b or c".</summary>
    private static string OrList(IEnumerable<string> items, string joiner = "or")
    {
        var list = items.ToList();
        return list.Count <= 1 ? string.Concat(list) : $"{string.Join(", ", list[..^1])} {joiner} {list[^1]}";
    }

    private async Task<Account> RequireAccount(Guid id, CancellationToken ct) =>
        await store.AccountAsync(id, ct) ?? throw new WorkspaceException(404, "Account not found.");
    private static AccountDto ToDto(Account a, AccountSnapshot? s) => new(a.Id, a.PortfolioId, a.Name, a.VenueId, a.Address,
        Money(a.VenueId == "manual" ? a.ManualAccountValueUsd : s?.AccountValueUsd), a.LastSyncedAtUtc,
        a.SyncStatus, a.LastSyncError, a.IsEnabled ? s?.Positions.Count ?? 0 : 0, a.HistoryNotice, a.IsEnabled, a.SettingsRevision,
        s?.StablecoinsObservedAtUtc is null ? null : StablecoinTotals.Sum(s.Stablecoins.Select(balance => balance.Available)),
        s?.StablecoinScope, s?.AccountMode,
        s?.StablecoinsObservedAtUtc is null ? null : StablecoinTotals.Sum(s.Stablecoins.Select(balance => balance.Total)),
        Balance(a, s) is { } balance ? StablecoinTotals.Sum([balance]) : null);

    /// <summary>
    /// What the account holds in nominal USD. Unified and portfolio-margin accounts keep every balance in the spot
    /// wallet (their perp state is not meaningful), so the wallet total is the balance. Other modes keep separate perp and
    /// spot ledgers, so perps equity and the wallet total add up. Supported stablecoins only; other assets are excluded.
    /// </summary>
    private static decimal? Balance(Account a, AccountSnapshot? s)
    {
        if (a.VenueId == "manual") return a.ManualAccountValueUsd;
        if (s is null) return null;
        decimal? wallet = s.StablecoinsObservedAtUtc is null ? null : s.Stablecoins.Sum(balance => balance.Total);
        if (s.AccountMode is "unifiedAccount" or "portfolioMargin") return wallet;
        return s.AccountValueUsd is { } perps ? perps + (wallet ?? 0) : wallet;
    }
    private static StablecoinWalletDto? WalletDto(AccountSnapshot snapshot) =>
        snapshot.StablecoinsObservedAtUtc is not { } observed ? null :
        new(observed, snapshot.AccountMode!, snapshot.StablecoinScope!,
            StablecoinTotals.Sum(snapshot.Stablecoins.Select(balance => balance.Total)),
            StablecoinTotals.Sum(snapshot.Stablecoins.Select(balance => balance.Available)),
            snapshot.Stablecoins.OrderBy(balance => balance.TokenIndex).Select(balance => new StablecoinBalanceDto(
                balance.Symbol, balance.TokenIndex, balance.TokenId, Money(balance.Total)!, Money(balance.Held)!, Money(balance.Available)!)).ToList(),
            "HyperCore spot/unified wallet only: supported stablecoin token identities, nominal USD-pegged units, no FX/depeg adjustment. Available is total minus held; it is not guaranteed withdrawal capacity or perpetual free margin. Other assets, EVM wallets and lending/borrow accounting are excluded. Primary perpetual margin is not added again.");
    private static FillDto ToDto(ImportedFill f) => new(f.Id, f.AccountId, f.ContractId, f.Side, f.Direction, Money(f.Price)!,
        Money(f.Quantity)!, Money(f.Fee)!, f.FeeToken, Money(f.ClosedPnlUsd)!, f.OccurredAtUtc, f.OrderId, f.SourceFillId, f.TransactionHash,
        f.PositionEffect, f.FeeBasis, f.PnlBasis);
}

file static class HexValidation
{
    public static bool ContainsOnlyHex(this ReadOnlySpan<char> text)
    {
        foreach (var c in text) if (!char.IsAsciiHexDigit(c)) return false;
        return true;
    }
}

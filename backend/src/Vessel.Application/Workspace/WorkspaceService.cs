using Vessel.Application.Common;
using Vessel.Application.Ownership;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Domain.Numerics;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Workspace;

public sealed class WorkspaceService(IWorkspaceStore store, IJournalOwnerContext owner, IVenueRegistry venues, IUnitOfWork unitOfWork)
{
    private static void ValidateName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 200)
            throw new ProblemException(400, "Name is required and must be at most 200 characters.");
    }

    private static void ValidateIcon(string? icon)
    {
        if (icon is not null && !PortfolioIcons.IsKnown(icon))
            throw new ProblemException(400, "Choose one of the available portfolio icons.");
    }

    public async Task<PortfolioDto> CreatePortfolioAsync(CreatePortfolioRequest request, CancellationToken ct)
    {
        ValidateName(request.Name);
        ValidateIcon(request.Icon);
        if (request.AccountIds is not null) ValidateAccountIds(request.AccountIds);
        ValidateExpected(request.AccountIds, request.Expected);
        return await unitOfWork.ExecuteAsync(() => store.WithManagementLockAsync(async () =>
        {
            var accounts = await LockAccounts(request.AccountIds ?? [], ct);
            CheckExpected(accounts, request.Expected);
            var portfolio = new Portfolio(Guid.NewGuid(), owner.OwnerId, request.Name, request.Icon ?? PortfolioIcons.Default);
            await store.AddPortfolioAsync(portfolio, ct);
            MoveAccounts(accounts, portfolio.Id);
            await store.SaveAsync(ct);
            return await PortfolioAsync(portfolio.Id, ct);
        }, ct), ct);
    }

    private static void ValidateAccountIds(IReadOnlyList<Guid>? ids)
    {
        if (ids is null || ids.Count is 0 or > 200 || ids.Distinct().Count() != ids.Count)
            throw new ProblemException(400, "Choose between 1 and 200 distinct accounts.");
    }

    private static void ValidateExpected(IReadOnlyList<Guid>? ids, IReadOnlyList<AccountSettingsExpectation>? expected)
    {
        if (expected is null) return;
        if (ids is null || expected.Count == 0 || expected.Count != ids.Count ||
            expected.Any(e => e is null || e.SettingsRevision < 1 || !ids.Contains(e.AccountId)) ||
            expected.Select(e => e.AccountId).Distinct().Count() != expected.Count)
            throw new ProblemException(400, "Provide exactly one positive settings revision for each selected account.");
    }

    private static void CheckExpected(IReadOnlyList<Account> accounts, IReadOnlyList<AccountSettingsExpectation>? expected)
    {
        if (expected is null) return;
        var revisions = expected.ToDictionary(e => e.AccountId, e => e.SettingsRevision);
        if (accounts.Any(a => a.SettingsRevision != revisions[a.Id]))
            throw new ProblemException(409, "Account settings changed elsewhere. No accounts were moved. Reload accounts and review the membership before retrying.");
    }

    private async Task<List<Account>> LockAccounts(IReadOnlyList<Guid> ids, CancellationToken ct)
    {
        var accounts = new List<Account>();
        // Take every row lock before changing settings; the management transaction holds them until commit.
        foreach (var id in ids.Order())
            accounts.Add(await store.WithAccountLockAsync(id, account => Task.FromResult(account), ct));
        return accounts;
    }

    private static void MoveAccounts(IEnumerable<Account> accounts, Guid? portfolioId)
    {
        foreach (var account in accounts)
            if (account.PortfolioId != portfolioId)
                account.UpdateSettings(account.Name, portfolioId, account.IsEnabled);
    }

    public async Task<IReadOnlyList<AccountDto>> MoveAccountsAsync(MoveAccountsRequest request, CancellationToken ct)
    {
        ValidateAccountIds(request.AccountIds);
        ValidateExpected(request.AccountIds, request.Expected);
        return await unitOfWork.ExecuteAsync(() => store.WithManagementLockAsync(async () =>
        {
            await ValidatePortfolio(request.PortfolioId, ct);
            var accounts = await LockAccounts(request.AccountIds!, ct);
            CheckExpected(accounts, request.Expected);
            MoveAccounts(accounts, request.PortfolioId);
            await store.SaveAsync(ct);
            var result = new List<AccountDto>();
            foreach (var account in accounts)
                result.Add(ToDto(account, await store.SnapshotAsync(account.Id, ct)));
            return result;
        }, ct), ct);
    }

    public async Task<AccountDto> CreateAccountAsync(CreateAccountRequest request, CancellationToken ct)
    {
        ValidateName(request.Name);
        var descriptor = venues.Descriptor(request.VenueId)
            ?? throw new ProblemException(400, $"Choose {OrList(venues.Descriptors.Select(d => d.Id))}.");

        if (request.PortfolioId == Guid.Empty) throw new ProblemException(404, "Portfolio not found.");
        decimal? value = null;
        string? sourceId = null, address = null;
        if (descriptor.Id == VenueDescriptor.ManualId)
        {
            if (request.Address is not null || request.SourceId is not null)
                throw new ProblemException(400, "Manual accounts do not use a source identity.");
            if (request.ManualAccountValueUsd is { } text)
            {
                if (!ExactDecimal.TryParseOwnerAmount(text, out var parsed))
                    throw new ProblemException(400, "Manual account value must be an exact nonnegative decimal string.");
                value = parsed;
            }
        }
        else
        {
            if (request.ManualAccountValueUsd is not null) throw new ProblemException(400, "Venue balances cannot be supplied manually.");
            if (descriptor.Source == VenueSources.EvmAddress)
            {
                sourceId = request.SourceId ?? request.Address;
                if (!AccountSource.IsEvmAddress(sourceId) ||
                    request.Address is not null && !string.Equals(request.Address, sourceId, StringComparison.OrdinalIgnoreCase))
                    throw new ProblemException(400, "A matching 42-character public hexadecimal address is required.");
                address = sourceId = sourceId!.ToLowerInvariant();
            }
            else if (descriptor.Source == VenueSources.AccountIndex)
            {
                if (request.Address is not null || !AccountSource.IsAccountIndex(request.SourceId))
                    throw new ProblemException(400, "Source ID must be a canonical nonnegative int64 account index string, without an address.");
                sourceId = request.SourceId;
            }
            else throw new ProblemException(400, "The venue source identity is unsupported.");
        }
        var account = new Account(Guid.NewGuid(), owner.OwnerId, request.VenueId, request.Name);
        account.Configure(request.PortfolioId, address, value, sourceId);
        await unitOfWork.ExecuteAsync(() => store.WithManagementLockAsync(async () =>
        {
            await ValidatePortfolio(request.PortfolioId, ct);
            if (account.SourceId is { } source && await store.SourceExistsAsync(account.VenueId, source, ct))
                throw new ProblemException(409, "An account for this venue and source already exists. Manage or re-enable that account.");
            await store.AddAccountAsync(account, ct);
            return true;
        }, ct), ct);
        return ToDto(account, null);
    }

    private async Task ValidatePortfolio(Guid? id, CancellationToken ct)
    {
        if (id.HasValue && !(await store.PortfoliosAsync(ct)).Any(p => p.Id == id))
            throw new ProblemException(404, "Portfolio not found.");
    }

    public async Task<PortfolioDto> UpdatePortfolioAsync(Guid id, UpdatePortfolioRequest request, CancellationToken ct)
    {
        ValidateName(request.Name);
        ValidateIcon(request.Icon);
        await unitOfWork.ExecuteAsync(() => store.WithManagementLockAsync(async () =>
        {
            var portfolio = (await store.PortfoliosAsync(ct)).SingleOrDefault(p => p.Id == id)
                ?? throw new ProblemException(404, "Portfolio not found.");
            portfolio.Rename(request.Name);
            if (request.Icon is not null) portfolio.ChangeIcon(request.Icon);
            await store.SaveAsync(ct);
            return true;
        }, ct), ct);
        return await PortfolioAsync(id, ct);
    }

    public async Task DeletePortfolioAsync(Guid id, CancellationToken ct) =>
        await unitOfWork.ExecuteAsync(() => store.WithManagementLockAsync(async () =>
        {
            await store.DeletePortfolioAsync(id, ct);
            return true;
        }, ct), ct);

    public async Task<AccountDto> UpdateAccountAsync(Guid id, UpdateAccountRequest request, CancellationToken ct)
    {
        ValidateName(request.Name);
        return await unitOfWork.ExecuteAsync(() => store.WithManagementLockAsync(() => store.WithAccountLockAsync(id, async account =>
        {
            if (request.ExpectedRevision != account.SettingsRevision)
                throw new ProblemException(409, "Account settings changed. Reload the current settings before saving.");
            await ValidatePortfolio(request.PortfolioId, ct);
            account.UpdateSettings(request.Name, request.PortfolioId, request.IsEnabled);
            await store.SaveAsync(ct);
            return ToDto(account, await store.SnapshotAsync(id, ct));
        }, ct), ct), ct);
    }

    public async Task DeleteAccountAsync(Guid id, CancellationToken ct) =>
        await unitOfWork.ExecuteAsync(() => store.WithManagementLockAsync(() => store.WithAccountLockAsync(id, async account =>
        {
            await store.DeleteAccountAsync(account, ct);
            return true;
        }, ct), ct), ct);

    public async Task<IReadOnlyList<AccountDto>> AccountsAsync(CancellationToken ct)
    {
        var accounts = await store.AccountsAsync(ct);
        var snapshots = (await store.SnapshotsAsync(ct)).ToDictionary(s => s.AccountId);
        return accounts.Select(a => ToDto(a, snapshots.GetValueOrDefault(a.Id))).ToList();
    }

    public async Task<IReadOnlyList<PortfolioDto>> PortfoliosAsync(CancellationToken ct) =>
        MapPortfolios(await store.PortfoliosAsync(ct), await store.AccountsAsync(ct),
            (await store.SnapshotsAsync(ct)).ToDictionary(s => s.AccountId));

    private List<PortfolioDto> MapPortfolios(IReadOnlyList<Portfolio> portfolios, IReadOnlyList<Account> accounts,
        IReadOnlyDictionary<Guid, AccountSnapshot> snapshots)
    {
        decimal? Value(Account a) => a.VenueId == VenueDescriptor.ManualId ? a.ManualAccountValueUsd : snapshots.GetValueOrDefault(a.Id)?.AccountValueUsd;
        return portfolios.Select(p =>
        {
            var members = accounts.Where(a => a.PortfolioId == p.Id).ToList();
            var enabledMembers = members.Where(a => a.IsEnabled).ToList();
            var values = enabledMembers.Select(Value).Where(v => v.HasValue).ToList();
            var balances = enabledMembers.Select(a => Balance(a, snapshots.GetValueOrDefault(a.Id))).OfType<IReadOnlyList<decimal>>().ToList();
            var available = enabledMembers.Select(a => AvailableBalance(a, snapshots.GetValueOrDefault(a.Id))).OfType<IReadOnlyList<decimal>>().ToList();
            return new PortfolioDto(p.Id, p.Name, members.Count, values.Count == 0 ? null : ExactDecimal.Sum(values.Select(v => v!.Value)),
                values.Count == 0 ? "unavailable" : values.Count == enabledMembers.Count ? "complete" : "partial",
                balances.Count == 0 ? null : ExactDecimal.Sum(balances.SelectMany(v => v!)),
                Coverage(balances.Count, enabledMembers.Count), p.Icon,
                available.Count == 0 ? null : ExactDecimal.Sum(available.SelectMany(v => v)),
                available.Count, Coverage(available.Count, enabledMembers.Count), enabledMembers.Count);
        }).ToList();
    }

    public async Task<OverviewDto> OverviewAsync(CancellationToken ct)
    {
        var accounts = await store.AccountsAsync(ct);
        var snapshots = (await store.SnapshotsAsync(ct)).ToDictionary(s => s.AccountId);
        var dtos = accounts.Select(a => ToDto(a, snapshots.GetValueOrDefault(a.Id))).ToList();
        decimal? Value(Account a) => a.VenueId == VenueDescriptor.ManualId ? a.ManualAccountValueUsd : snapshots.GetValueOrDefault(a.Id)?.AccountValueUsd;
        var portfolios = MapPortfolios(await store.PortfoliosAsync(ct), accounts, snapshots);
        var enabled = accounts.Where(a => a.IsEnabled).ToList();
        var known = enabled.Select(Value).Where(v => v.HasValue).ToList();
        var wallets = enabled.Select(a => snapshots.GetValueOrDefault(a.Id))
            .OfType<AccountSnapshot>().Where(s => s.StablecoinsObservedAtUtc.HasValue).ToList();
        var balances = enabled.Select(a => Balance(a, snapshots.GetValueOrDefault(a.Id))).OfType<IReadOnlyList<decimal>>().ToList();
        var available = enabled.Select(a => AvailableBalance(a, snapshots.GetValueOrDefault(a.Id))).OfType<IReadOnlyList<decimal>>().ToList();
        return new(portfolios, dtos, new(portfolios.Count, accounts.Count, known.Count == 0 ? null : ExactDecimal.Sum(known.Select(v => v!.Value)),
            known.Count, dtos.Sum(a => a.PositionCount), await store.FillCountAsync(ct),
            wallets.Count == 0 ? null : ExactDecimal.Sum(wallets.SelectMany(s => s.Stablecoins).Select(b => b.Available)), wallets.Count,
            balances.Count == 0 ? null : ExactDecimal.Sum(balances.SelectMany(b => b)), balances.Count, Coverage(balances.Count, enabled.Count),
            available.Count == 0 ? null : ExactDecimal.Sum(available.SelectMany(b => b)), available.Count, Coverage(available.Count, enabled.Count), enabled.Count),
            (await store.FillsAsync(null, 100, ct)).Select(ToDto).ToList(),
            "Enabled accounts across all portfolios and unassigned only. Total balance sums known perps/manual values and supported stablecoin wallet totals; unified and portfolio-margin accounts use the wallet alone. Available balance uses wallet total minus held in unified/portfolio-margin modes, otherwise reported available margin first, then withdrawable funds. Manual value, collateral and equity do not imply availability. Coverage counts accounts with a known amount, not full venue valuation. Nominal USD only: no FX, depeg, lending, EVM or risk adjustment. Availability is not guaranteed free trading margin or withdrawal. Imported fills are recent, not complete lifetime history.");
    }

    public async Task<SnapshotDto?> SnapshotAsync(Guid id, CancellationToken ct)
    {
        if (!(await RequireAccount(id, ct)).IsEnabled) return null;
        var s = await store.SnapshotAsync(id, ct);
        return s is null ? null : new(s.ObservedAtUtc, s.ValueScope, ExactDecimal.Format(s.AccountValueUsd),
            ExactDecimal.Format(s.WithdrawableUsd), ExactDecimal.Format(s.MarginUsedUsd),
            s.Positions.OrderBy(p => p.ContractId).Select(p => new PositionDto(p.ContractId, ExactDecimal.Format(p.SignedQuantity),
                ExactDecimal.Format(p.EntryPrice), ExactDecimal.Format(p.UnrealizedPnlUsd), ExactDecimal.Format(p.MarginUsedUsd), p.Leverage)).ToList(),
            WalletDto(s), ExactDecimal.Format(s.AvailableMarginUsd));
    }

    public async Task<PortfolioDto> PortfolioAsync(Guid id, CancellationToken ct) =>
        (await PortfoliosAsync(ct)).SingleOrDefault(p => p.Id == id) ??
        throw new ProblemException(404, "Portfolio not found.");

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
        var account = await store.MarketDataAccountAsync(id, ct) ?? throw new ProblemException(404, "Account not found.");
        if (!account.IsEnabled)
            throw new ProblemException(409, "Enable the account before reading its instrument catalogue.");
        if (account.VenueId == VenueDescriptor.ManualId)
            return new(account.VenueId, "perpetuals", InstrumentCatalogScopes.Manual, [],
                "Manual catalogue: enter a perpetual contract manually. No venue metadata is available.");
        if (venues.Reader(account.VenueId) is not { } reader)
            throw new ProblemException(502, "The venue instrument read failed. Try again later.");

        IReadOnlyList<VenueInstrument> instruments;
        try
        {
            instruments = await reader.ReadInstrumentsAsync(ct);
            ct.ThrowIfCancellationRequested();
        }
        catch (Exception ex) when (ex is VenueReadException or HttpRequestException ||
            ex is OperationCanceledException && !ct.IsCancellationRequested)
        {
            throw new ProblemException(502, "The venue instrument read failed. Try again later.");
        }
        return new(account.VenueId, "perpetuals", InstrumentCatalogScopes.Venue, instruments,
            "Venue perpetual contract metadata only. No orders, balances or execution refresh.");
    }

    /// <summary>"a", "a or b", "a, b or c".</summary>
    private static string OrList(IEnumerable<string> items)
    {
        var list = items.ToList();
        return list.Count <= 1 ? string.Concat(list) : $"{string.Join(", ", list[..^1])} or {list[^1]}";
    }

    private async Task<Account> RequireAccount(Guid id, CancellationToken ct) =>
        await store.AccountAsync(id, ct) ?? throw new ProblemException(404, "Account not found.");
    private AccountDto ToDto(Account a, AccountSnapshot? s) => new(a.Id, a.PortfolioId, a.Name, a.VenueId, a.Address,
        ExactDecimal.Format(a.VenueId == VenueDescriptor.ManualId ? a.ManualAccountValueUsd : s?.AccountValueUsd), a.LastSyncedAtUtc,
        a.SyncStatus, a.LastSyncError, a.IsEnabled ? s?.Positions.Count ?? 0 : 0, a.HistoryNotice, a.IsEnabled, a.SettingsRevision,
        s?.StablecoinsObservedAtUtc is null ? null : ExactDecimal.Sum(s.Stablecoins.Select(balance => balance.Available)),
        s?.StablecoinScope, s?.AccountMode,
        s?.StablecoinsObservedAtUtc is null ? null : ExactDecimal.Sum(s.Stablecoins.Select(balance => balance.Total)),
        Balance(a, s) is { } balance ? ExactDecimal.Sum(balance) : null, a.SourceId,
        AvailableBalance(a, s) is { } available ? ExactDecimal.Sum(available) : null, AvailableSource(a, s));

    /// <summary>
    /// What the account holds in nominal USD. Unified and portfolio-margin accounts keep every balance in the spot
    /// wallet (their perp state is not meaningful), so the wallet total is the balance. Other modes keep separate perp and
    /// spot ledgers, so perps equity and the wallet total add up. Supported stablecoins only; other assets are excluded.
    /// </summary>
    // Keep individual ledger amounts until the exact display sum; decimal addition can round within one account.
    private static List<decimal>? Balance(Account a, AccountSnapshot? s)
    {
        if (a.VenueId == VenueDescriptor.ManualId) return a.ManualAccountValueUsd is { } manual ? [manual] : null;
        if (s is null) return null;
        List<decimal>? wallet = s.StablecoinsObservedAtUtc is null ? null : s.Stablecoins.Select(balance => balance.Total).ToList();
        if (s.AccountMode is "unifiedAccount" or "portfolioMargin") return wallet;
        return s.AccountValueUsd is { } perps ? [perps, ..wallet ?? []] : wallet;
    }

    /// <summary>One reported availability source per enabled account. Never infer it from equity or margin used.</summary>
    private string? AvailableSource(Account a, AccountSnapshot? s)
    {
        if (!a.IsEnabled || a.VenueId == VenueDescriptor.ManualId || s is null) return null;
        if (venues.Descriptor(a.VenueId)?.Capabilities.StablecoinWallet == true &&
            s.AccountMode is "unifiedAccount" or "portfolioMargin")
            return s.StablecoinsObservedAtUtc is null ? null : "wallet";
        return s.AvailableMarginUsd is not null ? "margin" : s.WithdrawableUsd is not null ? "withdrawable" : null;
    }

    private List<decimal>? AvailableBalance(Account a, AccountSnapshot? s) => AvailableSource(a, s) switch
    {
        "wallet" => s!.Stablecoins.Select(balance => balance.Available).ToList(),
        "margin" => [s!.AvailableMarginUsd!.Value],
        "withdrawable" => [s!.WithdrawableUsd!.Value],
        _ => null
    };

    private static string Coverage(int known, int enabled) =>
        known == 0 ? "unavailable" : known == enabled ? "complete" : "partial";
    private static StablecoinWalletDto? WalletDto(AccountSnapshot snapshot) =>
        snapshot.StablecoinsObservedAtUtc is not { } observed ? null :
        new(observed, snapshot.AccountMode!, snapshot.StablecoinScope!,
            ExactDecimal.Sum(snapshot.Stablecoins.Select(balance => balance.Total)),
            ExactDecimal.Sum(snapshot.Stablecoins.Select(balance => balance.Available)),
            snapshot.Stablecoins.OrderBy(balance => balance.TokenIndex).Select(balance => new StablecoinBalanceDto(
                balance.Symbol, balance.TokenIndex, balance.TokenId, ExactDecimal.Format(balance.Total), ExactDecimal.Format(balance.Held),
                ExactDecimal.Format(balance.Available))).ToList(),
            "Venue stablecoin wallet only: supported stablecoin token identities, nominal USD-pegged units, no FX/depeg adjustment. Available is total minus held; it is not guaranteed withdrawal capacity or perpetual free margin. Other assets, EVM wallets and lending/borrow accounting are excluded. Perpetual margin is not added again.");
    private static FillDto ToDto(ImportedFill f) => new(f.Id, f.AccountId, f.ContractId, f.Side, f.Direction, ExactDecimal.Format(f.Price),
        ExactDecimal.Format(f.Quantity), ExactDecimal.Format(f.Fee), f.FeeToken, ExactDecimal.Format(f.ClosedPnlUsd), f.OccurredAtUtc,
        f.OrderId, f.SourceFillId, f.TransactionHash, f.PositionEffect, f.FeeBasis, f.PnlBasis);
}

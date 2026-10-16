using System.Text.Json;
using System.Numerics;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;
using Vessel.Infrastructure.Venues.Common;

namespace Vessel.Infrastructure.Venues.Lighter;

public sealed partial class LighterReader
{
    // Mainnet notices; each exchange words its own (LighterExchange). These names stay for existing callers.
    internal static string HistoryNotice => LighterExchange.Mainnet.HistoryNotice;
    internal static string PageLimitNotice => LighterExchange.Mainnet.PageLimitNotice;
    internal const string NonzeroRateNotice = "The account reports a nonzero maker or taker rate. No fills were imported.";
    internal const string CredentialRefusedNotice = "The optional read-only credential could not be verified. Public reads only; verify or replace the token.";
    internal const string HistoryRetryNotice = "The history credential was refused. Retrying this page once as a public read.";
    internal const string HistoryUnavailableNotice = "Recent execution history is unavailable without a usable read-only token. The public snapshot was refreshed; retained fills were not replaced.";
    internal static string MissingPnlNotice(int count) => $"{count} executions omitted because realized PnL was not reported.";
    internal static string FeeNotice(int count) => $"{count} fee-bearing or unverified-fee executions omitted.";
    internal static string SelfTradeNotice(int count) => $"{count} self-trade executions omitted.";

    public async Task<PerpetualVenueReadResult> ReadAsync(string sourceId, CancellationToken cancellationToken) =>
        (await ReadCoreAsync(Index(sourceId, venue), null, cancellationToken)).Result;

    public async Task<PerpetualVenueReadResult> ReadAsync(Account account, CancellationToken cancellationToken)
    {
        var source = Source(account);
        var attempt = await credentials.ReadAttemptAsync(account.Id, cancellationToken);
        var (result, refused) = await ReadCoreAsync(source, attempt?.Token, cancellationToken);
        // The account lock is reacquired after network I/O. A replacement cannot be marked by this attempt.
        if (refused && attempt is not null) await credentials.MarkRefusedAsync(account.Id, attempt.Revision, cancellationToken);
        return result;
    }

    private Task<(PerpetualVenueReadResult Result, bool CredentialRefused)> ReadCoreAsync(string source, string? credential, CancellationToken cancellationToken) =>
        BoundedAsync(async ct =>
        {
            var refused = false;
            var catalogue = await CatalogueAsync(ct, refresh: true);
            using var account = await AccountAsync(source, ct);
            var snapshot = ReadSnapshot(account.RootElement.GetProperty("accounts")[0], catalogue, timeProvider.GetUtcNow());
            // The index query validates exactly one matching account. Require the documented pagination
            // markers as well; missing markers or a local cap cannot establish a complete position list.
            var positionsComplete = account.RootElement.TryGetProperty("total", out var total) &&
                total.ValueKind == JsonValueKind.Number && total.TryGetInt64(out var count) && count == 1 &&
                account.RootElement.TryGetProperty("next_cursor", out var next) &&
                next.ValueKind == JsonValueKind.String && next.GetString() == "" &&
                Rows(json, account.RootElement.GetProperty("accounts")[0], "positions", MaxMarkets).GetArrayLength() < MaxMarkets &&
                catalogue.Markets.Count + catalogue.SpotIds.Count < MaxMarkets;
            var notices = new List<string> { venue.HistoryNotice };
            var feeFreeTier = false;
            var fillsAllowed = true;
            if (credential is not null)
            {
                try
                {
                    await BindAsync(source, credential, ct);
                    using var limits = await GetAsync("accountLimits?account_index=" + source, ct, credential);
                    var root = limits.RootElement;
                    var maker = json.Integer(json.Property(root, "current_maker_fee_tick"));
                    var taker = json.Integer(json.Property(root, "current_taker_fee_tick"));
                    fillsAllowed = maker == 0 && taker == 0;
                    // accountLimits uses tier codes; "standard" is user_tier_name, not user_tier.
                    feeFreeTier = fillsAllowed && Text(json, root, "user_tier") == "std";
                    if (!fillsAllowed) notices.Add(NonzeroRateNotice);
                }
                catch (LighterAuthenticationException)
                {
                    // A refused or expired optional credential must not block the public snapshot and public fills.
                    credential = null;
                    refused = true;
                    notices.Add(CredentialRefusedNotice);
                }
            }

            var fills = new List<VenueFill>();
            var fillCoverage = new RawFillReadCoverage();
            var historyAvailable = fillsAllowed;
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var cursors = new HashSet<string>(StringComparer.Ordinal);
            var missingPnl = 0;
            var fees = 0;
            var selfTrades = 0;
            string? cursor = null;
            if (fillsAllowed)
                // Each exchange's budget respects its trades weight (Robinhood's is three times mainnet's).
                for (var page = 0; page < venue.TradePages; page++)
                {
                    var query = "trades?account_index=" + source +
                        "&market_type=perp&sort_by=timestamp&sort_dir=desc&limit=100&aggregate=false" +
                        (cursor is null ? "" : "&cursor=" + Uri.EscapeDataString(cursor));
                    JsonDocument trades;
                    try
                    {
                        try { trades = await GetAsync(query, ct, credential); }
                        catch (LighterAuthenticationException) when (credential is not null)
                        {
                            credential = null;
                            refused = true;
                            feeFreeTier = false;
                            notices.Add(HistoryRetryNotice);
                            trades = await GetAsync(query, ct);
                        }
                    }
                    catch (LighterAuthenticationException)
                    {
                        notices.Add(HistoryUnavailableNotice);
                        historyAvailable = false;
                        cursor = null;
                        break;
                    }
                    using (trades)
                    {
                        var latest = timeProvider.GetUtcNow().AddMinutes(5);
                        var result = ReadFills(trades.RootElement, catalogue, source, latest, feeFreeTier);
                        fillCoverage.Observe(Rows(json, trades.RootElement, "trades", PageSize),
                            row => json.Timestamp(json.Property(row, "timestamp"), latest.ToUnixTimeMilliseconds()));
                        foreach (var fill in result.Fills)
                            if (ids.Add(fill.SourceFillId)) fills.Add(fill);
                        missingPnl += result.MissingPnl;
                        fees += result.Fees;
                        selfTrades += result.SelfTrades;
                        cursor = Cursor(json, trades.RootElement);
                    }
                    if (cursor is null) break;
                    if (!cursors.Add(cursor)) throw json.Invalid();
                }
            if (cursor is not null) notices.Add(venue.PageLimitNotice);
            if (missingPnl > 0) notices.Add(MissingPnlNotice(missingPnl));
            if (fees > 0) notices.Add(FeeNotice(fees));
            if (selfTrades > 0) notices.Add(SelfTradeNotice(selfTrades));
            return (new PerpetualVenueReadResult(snapshot,
                catalogue.Markets.Where(m => m.Active).Select(m => m.Instrument!).ToArray(), fills, string.Join(" ", notices),
                PositionsComplete: positionsComplete,
                FillHistoryTruncated: historyAvailable ? cursor is not null || fillCoverage.Count == venue.TradePages * PageSize : null,
                OldestRawFillAtUtc: historyAvailable ? fillCoverage.OldestAtUtc : null,
                // Self-trades are out of scope (they leave the position unchanged); these are in-scope facts left out.
                OmittedExecutions: missingPnl + fees), refused);
        }, cancellationToken);

    internal static VenueSnapshot ReadSnapshot(JsonElement account, Catalogue catalogue, DateTimeOffset observed)
    {
        var exchange = catalogue.Exchange;
        var json = exchange.Json;
        // https://docs.lighter.xyz/trading/multi-asset-margin.md: non-collateral margin changes equity semantics.
        // Unified collateral-only accounts use the ordinary perps calculation; do not reject them just for their mode.
        // The exchange's collateral (USDC on mainnet, USDG on Robinhood) must be asset 3. Robinhood margin-enables
        // tokenized stocks; they are refused rather than valued.
        foreach (var asset in Rows(json, account, "assets", 256).EnumerateArray())
        {
            var symbol = Text(json, asset, "symbol", 24);
            var margin = Nonnegative(json, asset, "margin_balance");
            if (symbol != exchange.Collateral && margin != 0)
                throw new VenueReadException(exchange.CollateralUnsupported);
            if (symbol == exchange.Collateral && Identity(json, json.Property(asset, "asset_id")) != LighterExchange.CollateralAssetId)
                throw json.Invalid();
        }
        if (account.TryGetProperty("bo_positions", out var binary) && json.Array(binary).GetArrayLength() > 0)
            throw new VenueReadException(exchange.BinaryUnsupported);

        var positions = new List<VenuePosition>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var isolatedRequirement = 0m;
        foreach (var row in Rows(json, account, "positions", MaxMarkets).EnumerateArray())
        {
            var quantity = Nonnegative(json, row, "position");
            if (quantity == 0) continue;
            var id = Identity(json, json.Property(row, "market_id"));
            var market = catalogue.ById(id) ?? throw new VenueReadException(exchange.PositionMarketUnsupported);
            if (!ids.Add(id) || Text(json, row, "symbol", 24) != market.Key) throw json.Invalid();
            var sign = json.Integer(json.Property(row, "sign"));
            var mode = json.Integer(json.Property(row, "margin_mode"));
            var fraction = json.Positive(json.Property(row, "initial_margin_fraction"));
            if (sign is not (-1 or 1) || mode is not (0 or 1) || fraction > 100) throw json.Invalid();
            // Official IMR = abs(position) * mark * fraction. position_value is the reported mark notional.
            // Isolated allocated_margin is COLLATERAL, not IMR, and must not be used as margin requirement.
            var notional = Nonnegative(json, row, "position_value");
            var requirement = checked(notional * fraction / 100m);
            if (StrictJson.DecimalUnits(requirement) * 100 * BigInteger.Pow(10, 28) !=
                StrictJson.DecimalUnits(notional) * StrictJson.DecimalUnits(fraction)) throw json.Invalid();
            if (mode == 1) isolatedRequirement = ExactSum(json, isolatedRequirement, requirement);
            var leverage = 100m / fraction;
            positions.Add(new(market.Key, quantity * sign, json.Positive(json.Property(row, "avg_entry_price")),
                Number(json, row, "unrealized_pnl"), requirement,
                leverage <= 1000 && leverage == decimal.Truncate(leverage) ? (int)leverage : null,
                VenueContractId: id));
        }
        return new(observed, exchange.SnapshotScope, Number(json, account, "total_asset_value"), null,
            ExactSum(json, Nonnegative(json, account, "cross_initial_margin_requirement"), isolatedRequirement), positions,
            AvailableMarginUsd: json.OptionalAmount(account, "available_balance"));
    }

    private static decimal ExactSum(StrictJson json, decimal first, decimal second)
    {
        var result = checked(first + second);
        if (StrictJson.DecimalUnits(result) != StrictJson.DecimalUnits(first) + StrictJson.DecimalUnits(second)) throw json.Invalid();
        return result;
    }

    internal sealed record FillPage(IReadOnlyList<VenueFill> Fills, int MissingPnl, int Fees, int SelfTrades = 0);

    internal static string Effect(string side, decimal before, decimal quantity) =>
        before == 0 || (before > 0) == (side == ExecutionFacts.Buy) ? ExecutionFacts.Open
        : quantity > Math.Abs(before) ? ExecutionFacts.Flip : ExecutionFacts.Close;

    // The official Trade schema now explicitly calls ask/bid_account_pnl realized PnL for the queried account.
    // https://apidocs.lighter.xyz/reference/trades.md, verified 2026-10-07.
    // Mainnet omits these fields on some public responses. Absence is NOT evidence of zero.
    internal static FillPage ReadFills(JsonElement root, Catalogue catalogue, string source, DateTimeOffset latest, bool standardTier)
    {
        var json = catalogue.Exchange.Json;
        // Standard-account fills are fee-free; the fee token and quote are the exchange's collateral.
        var collateral = catalogue.Exchange.Collateral;
        var fills = new List<VenueFill>();
        var missingPnl = 0;
        var fees = 0;
        var selfTrades = 0;
        foreach (var row in Rows(json, root, "trades", PageSize).EnumerateArray())
        {
            var marketId = Identity(json, json.Property(row, "market_id"));
            if (catalogue.SpotIds.Contains(marketId)) continue;
            var market = catalogue.ById(marketId) ?? throw json.Invalid();
            var ask = Identity(json, json.Property(row, "ask_account_id")) == source;
            var bid = Identity(json, json.Property(row, "bid_account_id")) == source;
            if (!ask && !bid) throw json.Invalid();
            // A self-trade has two account roles and cannot become a single execution fact without inventing semantics.
            // Omit it like other unsupported records; failing would block every refresh while it stays in recent history.
            if (ask && bid) { selfTrades++; continue; }
            var side = ask ? ExecutionFacts.Sell : ExecutionFacts.Buy;
            var maker = json.Boolean(json.Property(row, "is_maker_ask")) == ask;
            var role = maker ? "maker" : "taker";
            var before = Number(json, row, role + "_position_size_before");
            var quantity = json.Positive(json.Property(row, "size"));
            var effect = Effect(side, before, quantity);
            if (row.TryGetProperty(role + "_position_sign_changed", out var changed)) json.Boolean(changed);
            var type = Text(json, row, "type");
            if (type is not ("trade" or "liquidation" or "deleverage" or "market-settlement")) throw json.Invalid();

            // Trade fee fields are rates, not fee amounts. Never apply the other counterparty's tier to this account.
            // If a rate is absent and the tier has not been verified, the execution's fee is unknown.
            // Standard TWAP and integrator fees must still pass the explicit per-execution checks.
            var hasFee = row.TryGetProperty(role + "_fee", out var rate);
            var rateValue = hasFee ? json.Integer(rate) : 0;
            var integratorRate = row.TryGetProperty("integrator_" + role + "_fee", out var integrator) ? json.Integer(integrator) : 0;
            if (rateValue != 0 || integratorRate != 0 || (!hasFee && !standardTier) || type != "trade")
            {
                fees++;
                continue;
            }
            var pnlName = ask ? "ask_account_pnl" : "bid_account_pnl";
            if (!row.TryGetProperty(pnlName, out var pnlValue)) { missingPnl++; continue; }
            var pnl = json.Number(pnlValue);
            var id = ExactId(json, row, "trade_id", "trade_id_str");
            var orderId = ExactId(json, row, ask ? "ask_id" : "bid_id", ask ? "ask_id_str" : "bid_id_str");
            var at = json.Timestamp(json.Property(row, "timestamp"), latest.ToUnixTimeMilliseconds());
            var price = json.Positive(json.Property(row, "price"));
            var hash = Text(json, row, "tx_hash", 256);
            if (!hash.All(char.IsAsciiHexDigit)) throw json.Invalid();
            var direction = effect switch
            {
                ExecutionFacts.Open => ask ? "Open Short" : "Open Long",
                ExecutionFacts.Close => ask ? "Close Long" : "Close Short",
                _ => ask ? "Long to Short" : "Short to Long"
            };
            // Project only validated fields; never persist unknown server fields which might echo an auth header.
            var raw = JsonSerializer.Serialize(new
            {
                trade_id = id, market_id = marketId, type, ask_account_id = Identity(json, json.Property(row, "ask_account_id")),
                bid_account_id = Identity(json, json.Property(row, "bid_account_id")), order_id = orderId,
                size = Text(json, row, "size"), price = Text(json, row, "price"), realized_pnl = json.Text(pnlValue),
                timestamp = at.ToUnixTimeMilliseconds(), tx_hash = hash, account_role = role,
                position_size_before = Text(json, row, role + "_position_size_before"), fee_rate = rateValue
            });
            fills.Add(new(id, market.Key, side, direction, price, quantity, 0, collateral, pnl, at, orderId, hash, raw,
                effect, standardTier ? ExecutionFacts.FeeStandardAccountFree : ExecutionFacts.FeeReported,
                ExecutionFacts.PnlGross, marketId));
        }
        return new(fills, missingPnl, fees, selfTrades);
    }
}

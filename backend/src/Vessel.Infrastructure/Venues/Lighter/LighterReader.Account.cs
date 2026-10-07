using System.Text.Json;
using System.Numerics;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;
using Vessel.Infrastructure.Venues.Common;

namespace Vessel.Infrastructure.Venues.Lighter;

public sealed partial class LighterReader
{
    private const string HistoryNotice =
        "Incomplete Lighter history: at most 500 recent perpetual executions in five pages; no backfill. " +
        "Only verified fee-free executions; fee-bearing history is not imported. " +
        "Executions without reported realized PnL are unsupported and are not imported. " +
        "Liquidation, deleverage and settlement records are unsupported. " +
        "USDC perpetual equity only; spot wallets are not added. Margin shows initial-margin requirements, " +
        "with position requirements calculated from the venue's notional and initial-margin fraction. Withdrawal availability is unknown.";

    public Task<PerpetualVenueReadResult> ReadAsync(string sourceId, CancellationToken cancellationToken) =>
        ReadCoreAsync(Index(sourceId), null, cancellationToken);

    public async Task<PerpetualVenueReadResult> ReadAsync(Account account, CancellationToken cancellationToken)
    {
        var source = Source(account);
        var token = await credentials.ReadAsync(account.Id, cancellationToken);
        return await ReadCoreAsync(source, token, cancellationToken);
    }

    private Task<PerpetualVenueReadResult> ReadCoreAsync(string source, string? credential, CancellationToken cancellationToken) =>
        BoundedAsync(async ct =>
        {
            var catalogue = await CatalogueAsync(ct);
            using var account = await AccountAsync(source, ct);
            var snapshot = ReadSnapshot(account.RootElement.GetProperty("accounts")[0], catalogue, timeProvider.GetUtcNow());
            var notices = new List<string> { HistoryNotice };
            var feeFreeTier = false;
            var fillsAllowed = true;
            if (credential is not null)
            {
                try
                {
                    await BindAsync(source, credential, ct);
                    using var limits = await GetAsync("accountLimits?account_index=" + source, ct, credential);
                    var root = limits.RootElement;
                    var maker = Json.Integer(Json.Property(root, "current_maker_fee_tick"));
                    var taker = Json.Integer(Json.Property(root, "current_taker_fee_tick"));
                    fillsAllowed = maker == 0 && taker == 0;
                    // accountLimits uses tier codes; "standard" is user_tier_name, not user_tier.
                    feeFreeTier = fillsAllowed && Text(root, "user_tier") == "std";
                    if (!fillsAllowed) notices.Add("The account reports a nonzero maker or taker rate. No fills were imported.");
                }
                catch (LighterAuthenticationException)
                {
                    // A refused or expired optional credential must not block the public snapshot and public fills.
                    credential = null;
                    notices.Add("The optional read-only credential could not be verified. Public reads only; verify or replace the token.");
                }
            }

            var fills = new List<VenueFill>();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var cursors = new HashSet<string>(StringComparer.Ordinal);
            var missingPnl = 0;
            var fees = 0;
            var selfTrades = 0;
            string? cursor = null;
            if (fillsAllowed)
                for (var page = 0; page < MaxPages; page++)
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
                            feeFreeTier = false;
                            notices.Add("The history credential was refused. Retrying this page once as a public read.");
                            trades = await GetAsync(query, ct);
                        }
                    }
                    catch (LighterAuthenticationException)
                    {
                        notices.Add("Recent execution history is unavailable without a usable read-only token. The public snapshot was refreshed; retained fills were not replaced.");
                        cursor = null;
                        break;
                    }
                    using (trades)
                    {
                        var result = ReadFills(trades.RootElement, catalogue, source, timeProvider.GetUtcNow().AddMinutes(5), feeFreeTier);
                        foreach (var fill in result.Fills)
                            if (ids.Add(fill.SourceFillId)) fills.Add(fill);
                        missingPnl += result.MissingPnl;
                        fees += result.Fees;
                        selfTrades += result.SelfTrades;
                        cursor = Cursor(trades.RootElement);
                    }
                    if (cursor is null) break;
                    if (!cursors.Add(cursor)) throw Json.Invalid();
                }
            if (cursor is not null) notices.Add("The five-page history limit was reached; older executions remain unimported.");
            if (missingPnl > 0) notices.Add($"{missingPnl} executions omitted because realized PnL was not reported.");
            if (fees > 0) notices.Add($"{fees} fee-bearing or unverified-fee executions omitted.");
            if (selfTrades > 0) notices.Add($"{selfTrades} self-trade executions omitted.");
            return new PerpetualVenueReadResult(snapshot,
                catalogue.Markets.Where(m => m.Active).Select(m => m.Instrument!).ToArray(), fills, string.Join(" ", notices));
        }, cancellationToken);

    internal static VenueSnapshot ReadSnapshot(JsonElement account, Catalogue catalogue, DateTimeOffset observed)
    {
        // https://docs.lighter.xyz/trading/multi-asset-margin.md: non-USDC margin changes equity semantics.
        // Unified USDC-only accounts use the ordinary perps calculation; do not reject them just for their mode.
        foreach (var asset in Rows(account, "assets", 256).EnumerateArray())
        {
            var symbol = Text(asset, "symbol", 24);
            var margin = Nonnegative(asset, "margin_balance");
            if (symbol != QuoteAsset && margin != 0)
                throw new VenueReadException("Lighter non-USDC collateral valuation is not supported. No partial snapshot was imported.");
            if (symbol == QuoteAsset && Identity(Json.Property(asset, "asset_id")) != "3") throw Json.Invalid();
        }
        if (account.TryGetProperty("bo_positions", out var binary) && Json.Array(binary).GetArrayLength() > 0)
            throw new VenueReadException("Lighter binary positions are not supported. No partial snapshot was imported.");

        var positions = new List<VenuePosition>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var isolatedRequirement = 0m;
        foreach (var row in Rows(account, "positions", MaxMarkets).EnumerateArray())
        {
            var quantity = Nonnegative(row, "position");
            if (quantity == 0) continue;
            var id = Identity(Json.Property(row, "market_id"));
            var market = catalogue.ById(id) ?? throw new VenueReadException("A Lighter position uses an unsupported market.");
            if (!ids.Add(id) || Text(row, "symbol", 24) != market.Key) throw Json.Invalid();
            var sign = Json.Integer(Json.Property(row, "sign"));
            var mode = Json.Integer(Json.Property(row, "margin_mode"));
            var fraction = Json.Positive(Json.Property(row, "initial_margin_fraction"));
            if (sign is not (-1 or 1) || mode is not (0 or 1) || fraction > 100) throw Json.Invalid();
            // Official IMR = abs(position) * mark * fraction. position_value is the reported mark notional.
            // Isolated allocated_margin is COLLATERAL, not IMR, and must not be used as margin requirement.
            var notional = Nonnegative(row, "position_value");
            var requirement = checked(notional * fraction / 100m);
            if (StrictJson.DecimalUnits(requirement) * 100 * BigInteger.Pow(10, 28) !=
                StrictJson.DecimalUnits(notional) * StrictJson.DecimalUnits(fraction)) throw Json.Invalid();
            if (mode == 1) isolatedRequirement = ExactSum(isolatedRequirement, requirement);
            var leverage = 100m / fraction;
            positions.Add(new(market.Key, quantity * sign, Json.Positive(Json.Property(row, "avg_entry_price")),
                Number(row, "unrealized_pnl"), requirement,
                leverage <= 1000 && leverage == decimal.Truncate(leverage) ? (int)leverage : null,
                VenueContractId: id));
        }
        return new(observed, "lighter-perps-account", Number(account, "total_asset_value"), null,
            ExactSum(Nonnegative(account, "cross_initial_margin_requirement"), isolatedRequirement), positions);
    }

    private static decimal ExactSum(decimal first, decimal second)
    {
        var result = checked(first + second);
        if (StrictJson.DecimalUnits(result) != StrictJson.DecimalUnits(first) + StrictJson.DecimalUnits(second)) throw Json.Invalid();
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
        var fills = new List<VenueFill>();
        var missingPnl = 0;
        var fees = 0;
        var selfTrades = 0;
        foreach (var row in Rows(root, "trades", PageSize).EnumerateArray())
        {
            var marketId = Identity(Json.Property(row, "market_id"));
            if (catalogue.SpotIds.Contains(marketId)) continue;
            var market = catalogue.ById(marketId) ?? throw Json.Invalid();
            var ask = Identity(Json.Property(row, "ask_account_id")) == source;
            var bid = Identity(Json.Property(row, "bid_account_id")) == source;
            if (!ask && !bid) throw Json.Invalid();
            // A self-trade has two account roles and cannot become a single execution fact without inventing semantics.
            // Omit it like other unsupported records; failing would block every refresh while it stays in recent history.
            if (ask && bid) { selfTrades++; continue; }
            var side = ask ? ExecutionFacts.Sell : ExecutionFacts.Buy;
            var maker = Json.Boolean(Json.Property(row, "is_maker_ask")) == ask;
            var role = maker ? "maker" : "taker";
            var before = Number(row, role + "_position_size_before");
            var quantity = Json.Positive(Json.Property(row, "size"));
            var effect = Effect(side, before, quantity);
            if (row.TryGetProperty(role + "_position_sign_changed", out var changed)) Json.Boolean(changed);
            var type = Text(row, "type");
            if (type is not ("trade" or "liquidation" or "deleverage" or "market-settlement")) throw Json.Invalid();

            // Trade fee fields are rates, not fee amounts. Never apply the other counterparty's tier to this account.
            // If a rate is absent and the tier has not been verified, the execution's fee is unknown.
            // Standard TWAP and integrator fees must still pass the explicit per-execution checks.
            var hasFee = row.TryGetProperty(role + "_fee", out var rate);
            var rateValue = hasFee ? Json.Integer(rate) : 0;
            var integratorRate = row.TryGetProperty("integrator_" + role + "_fee", out var integrator) ? Json.Integer(integrator) : 0;
            if (rateValue != 0 || integratorRate != 0 || (!hasFee && !standardTier) || type != "trade")
            {
                fees++;
                continue;
            }
            var pnlName = ask ? "ask_account_pnl" : "bid_account_pnl";
            if (!row.TryGetProperty(pnlName, out var pnlValue)) { missingPnl++; continue; }
            var pnl = Json.Number(pnlValue);
            var id = ExactId(row, "trade_id", "trade_id_str");
            var orderId = ExactId(row, ask ? "ask_id" : "bid_id", ask ? "ask_id_str" : "bid_id_str");
            var at = Json.Timestamp(Json.Property(row, "timestamp"), latest.ToUnixTimeMilliseconds());
            var price = Json.Positive(Json.Property(row, "price"));
            var hash = Text(row, "tx_hash", 256);
            if (!hash.All(char.IsAsciiHexDigit)) throw Json.Invalid();
            var direction = effect switch
            {
                ExecutionFacts.Open => ask ? "Open Short" : "Open Long",
                ExecutionFacts.Close => ask ? "Close Long" : "Close Short",
                _ => ask ? "Long to Short" : "Short to Long"
            };
            // Project only validated fields; never persist unknown server fields which might echo an auth header.
            var raw = JsonSerializer.Serialize(new
            {
                trade_id = id, market_id = marketId, type, ask_account_id = Identity(Json.Property(row, "ask_account_id")),
                bid_account_id = Identity(Json.Property(row, "bid_account_id")), order_id = orderId,
                size = Text(row, "size"), price = Text(row, "price"), realized_pnl = Json.Text(pnlValue),
                timestamp = at.ToUnixTimeMilliseconds(), tx_hash = hash, account_role = role,
                position_size_before = Text(row, role + "_position_size_before"), fee_rate = rateValue
            });
            fills.Add(new(id, market.Key, side, direction, price, quantity, 0, QuoteAsset, pnl, at, orderId, hash, raw,
                effect, standardTier ? ExecutionFacts.FeeStandardAccountFree : ExecutionFacts.FeeReported,
                ExecutionFacts.PnlGross, marketId));
        }
        return new(fills, missingPnl, fees, selfTrades);
    }
}

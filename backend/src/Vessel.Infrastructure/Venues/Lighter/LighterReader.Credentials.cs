using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Lighter;

public sealed partial class LighterReader
{
    [GeneratedRegex(@"\A0x[0-9a-fA-F]{40}\z", RegexOptions.CultureInvariant)]
    private static partial Regex AddressPattern();

    [GeneratedRegex(@"\Aro:([0-9]{1,19}):(single|all):([0-9]{10}):[0-9a-f]+\z", RegexOptions.CultureInvariant)]
    private static partial Regex TokenPattern();

    private static string Address(string address) => address is not null && AddressPattern().IsMatch(address)
        ? address.ToLowerInvariant() : throw new VenueReadException("A valid Lighter L1 address is required.");

    private sealed record ReadToken(string Index, string Scope, DateTimeOffset Expiry);

    private ReadToken Token(string token)
    {
        const string invalid = "Enter a Lighter read-only token in ro:index:single|all:expiry:hex format.";
        if (token is null || token.Length > 512) throw new VenueReadException(invalid);
        var match = TokenPattern().Match(token);
        if (!match.Success || !long.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var index))
            throw new VenueReadException(invalid);
        var expiry = DateTimeOffset.FromUnixTimeSeconds(long.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture));
        if (expiry <= timeProvider.GetUtcNow())
            // It may expire while queued or after the public snapshot read. Keep the public fallback available.
            throw new LighterAuthenticationException();
        return new(index.ToString(CultureInfo.InvariantCulture), match.Groups[2].Value, expiry);
    }

    private async Task<JsonDocument> AccountAsync(string index, CancellationToken ct)
    {
        var document = await GetAsync("account?by=index&value=" + index, ct);
        try
        {
            var accounts = Rows(document.RootElement, "accounts", 1);
            if (accounts.GetArrayLength() != 1 || Identity(Json.Property(accounts[0], "index")) != index ||
                Identity(Json.Property(accounts[0], "account_index")) != index)
                throw Json.Invalid();
            return document;
        }
        catch { document.Dispose(); throw; }
    }

    // Core concepts guarantees the first discovery entry is the master, not the numerically smallest ID.
    // https://apidocs.lighter.xyz/docs/core-concepts.md and /reference/accountsbyl1address.md, 2026-10-07.
    private async Task<IReadOnlyList<VenueAccountCandidate>> DiscoverCoreAsync(string address, CancellationToken ct)
    {
        var candidates = new List<VenueAccountCandidate>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var cursors = new HashSet<string>(StringComparer.Ordinal);
        string? cursor = null;
        for (var page = 0; page < MaxPages; page++)
        {
            using var document = await GetAsync("accountsByL1Address?l1_address=" + address +
                (cursor is null ? "" : "&cursor=" + Uri.EscapeDataString(cursor)), ct);
            var root = document.RootElement;
            if (Address(Text(root, "l1_address", 42)) != address) throw Json.Invalid();
            foreach (var row in Rows(root, "sub_accounts", 200).EnumerateArray())
            {
                var id = Identity(Json.Property(row, "index"));
                if (!ids.Add(id) || Address(Text(row, "l1_address", 42)) != address) throw Json.Invalid();
                var type = Json.Integer(Json.Property(row, "account_type"));
                // Public/staking pools are not personal subaccounts and are not imported.
                if (type is not (0 or 1)) continue;
                var isMain = type == 0;
                if (isMain != (candidates.Count == 0 && page == 0)) throw Json.Invalid();
                candidates.Add(new(id, isMain ? "Main account" : "Subaccount " + id,
                    isMain ? "main" : "subaccount", CollateralUsd: DiscoveryAmount(row, "collateral"),
                    AvailableBalanceUsd: DiscoveryAmount(row, "available_balance")));
                // Discovery reports collateral/available balance, not equity. Do not label either account value.
            }
            cursor = Cursor(root);
            if (cursor is null) return candidates;
            if (!cursors.Add(cursor)) throw Json.Invalid();
        }
        throw new VenueReadException("Lighter account discovery exceeded five pages. No partial account list was accepted.");
    }

    public Task<IReadOnlyList<VenueAccountCandidate>> DiscoverAsync(string address, CancellationToken cancellationToken) =>
        BoundedAsync(ct => DiscoverCoreAsync(Address(address), ct), cancellationToken);

    private static string? DiscoveryAmount(JsonElement row, string field)
    {
        if (!row.TryGetProperty(field, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        var text = Json.Text(value);
        _ = Json.ParseDecimal(text);
        return text;
    }

    // accountMetadata requires authorization even though discovery balances are public.
    // Read-only token stays in the header; join by exact account index, never response order.
    public Task<IReadOnlyList<VenueAccountCandidate>> DiscoverAsync(string address, string token, CancellationToken cancellationToken) =>
        BoundedAsync<IReadOnlyList<VenueAccountCandidate>>(async ct =>
        {
            var wallet = Address(address);
            var parsed = Token(token);
            var accounts = await DiscoverCoreAsync(wallet, ct);
            if (!accounts.Any(a => a.SourceId == parsed.Index) ||
                parsed.Scope == "all" && accounts[0].SourceId != parsed.Index)
                throw new VenueReadException("The read-only token belongs to a different wallet or main account.");
            var names = new Dictionary<string, string>(StringComparer.Ordinal);
            var ids = accounts.Select(a => a.SourceId).ToHashSet(StringComparer.Ordinal);
            var cursors = new HashSet<string>(StringComparer.Ordinal);
            string? cursor = null;
            for (var page = 0; page < MaxPages; page++)
            {
                Token(token);
                var query = parsed.Scope == "all" ? "by=l1_address&value=" + wallet : "by=index&value=" + parsed.Index;
                using var document = await GetAsync("accountMetadata?" + query +
                    (cursor is null ? "" : "&cursor=" + Uri.EscapeDataString(cursor)), ct, token);
                foreach (var row in Rows(document.RootElement, "account_metadatas", 200).EnumerateArray())
                {
                    var id = Identity(Json.Property(row, "account_index"));
                    // Wallet metadata can include pools that public discovery deliberately excludes.
                    // Never add candidates or names for indices outside the authoritative personal list.
                    if (parsed.Scope == "all" && !ids.Contains(id)) continue;
                    var name = Json.TextOrEmpty(Json.Property(row, "name"), 200);
                    if (!ids.Contains(id) || parsed.Scope == "single" && id != parsed.Index ||
                        name.Contains(token, StringComparison.Ordinal) || !names.TryAdd(id, name))
                        throw Json.Invalid();
                }
                cursor = Cursor(document.RootElement);
                if (cursor is null)
                    return accounts.Select(a => names.TryGetValue(a.SourceId, out var name) && !string.IsNullOrWhiteSpace(name)
                        ? a with { Name = name } : a).ToList();
                if (!cursors.Add(cursor)) throw Json.Invalid();
            }
            throw new VenueReadException("Lighter account names exceeded five pages. No partial names were accepted.");
        }, cancellationToken);

    private async Task<ReadToken> BindAsync(string sourceId, string token, CancellationToken ct)
    {
        var parsed = Token(token);
        if (parsed.Scope == "single" && parsed.Index != sourceId)
            throw new VenueReadException("The read-only token belongs to a different Lighter account.");
        using var account = await AccountAsync(sourceId, ct);
        var address = Address(Text(account.RootElement.GetProperty("accounts")[0], "l1_address", 42));
        var accounts = await DiscoverCoreAsync(address, ct);
        if (!accounts.Any(a => a.SourceId == sourceId) ||
            (parsed.Scope == "all" && accounts.FirstOrDefault(a => a.AccountType == "main")?.SourceId != parsed.Index))
            throw new VenueReadException("The read-only token scope does not match this Lighter account and its master.");
        return parsed;
    }

    public Task<VerifiedVenueCredential> VerifyAsync(string sourceId, string token, CancellationToken cancellationToken)
    {
        var source = Index(sourceId);
        return BoundedAsync(async ct =>
        {
            var parsed = await BindAsync(source, token, ct);
            // Never accept syntax alone. This is an authenticated, account-bound read, including for an empty account.
            using var orders = await GetAsync("accountActiveOrders?account_index=" + source + "&market_type=perp", ct, token);
            foreach (var row in Rows(orders.RootElement, "orders", 1000).EnumerateArray())
                if (Identity(Json.Property(row, "owner_account_index")) != source) throw Json.Invalid();
            if (parsed.Expiry <= timeProvider.GetUtcNow()) throw new VenueReadException("Token expired: enter a new read-only token.");
            return new VerifiedVenueCredential(parsed.Scope, parsed.Expiry);
        }, cancellationToken);
    }
}

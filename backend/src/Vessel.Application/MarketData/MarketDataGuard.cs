using System.Text.RegularExpressions;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;

namespace Vessel.Application.MarketData;

// Shared, ordered request checks for the public market data use cases.
// Order matters for clients: account (404), disabled/manual (409), instrument and interval (400).
internal static partial class MarketDataGuard
{
    public const string IntervalMessage =
        "Interval must be one of 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 3d, 1w, 1M.";

    public static readonly IReadOnlyDictionary<string, long> IntervalMs = new Dictionary<string, long>(StringComparer.Ordinal)
    {
        ["1m"] = 60_000L, ["3m"] = 3 * 60_000L, ["5m"] = 5 * 60_000L, ["15m"] = 15 * 60_000L,
        ["30m"] = 30 * 60_000L, ["1h"] = 3_600_000L, ["2h"] = 2 * 3_600_000L, ["4h"] = 4 * 3_600_000L,
        ["8h"] = 8 * 3_600_000L, ["12h"] = 12 * 3_600_000L, ["1d"] = 86_400_000L, ["3d"] = 3 * 86_400_000L,
        ["1w"] = 7 * 86_400_000L, ["1M"] = 31 * 86_400_000L
    };

    [GeneratedRegex("^[A-Za-z0-9_-]{1,32}$")]
    private static partial Regex InstrumentPattern();

    public static async Task<Account> AccountAsync(IWorkspaceStore store, Guid accountId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var account = await store.AccountAsync(accountId, ct) ?? throw new WorkspaceException(404, "Account not found.");
        if (!account.IsEnabled)
            throw new WorkspaceException(409, "Enable the account before reading market data.");
        if (account.VenueId == "manual")
            throw new WorkspaceException(409, "No market data provider for manual accounts.");
        return account;
    }

    public static string Instrument(string? instrument) =>
        instrument is not null && InstrumentPattern().IsMatch(instrument)
            ? instrument
            : throw new WorkspaceException(400, "Instrument must be 1 to 32 letters, digits, hyphens or underscores.");

    public static (string Interval, long Step) Interval(string? interval) =>
        interval is not null && IntervalMs.TryGetValue(interval, out var step)
            ? (interval, step)
            : throw new WorkspaceException(400, IntervalMessage);
}

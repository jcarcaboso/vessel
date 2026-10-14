namespace Vessel.Application.Workspace;

/// <summary>
/// The single list of USD stablecoins counted at nominal value: one token is one USD, with no FX or depeg valuation.
/// Fees in a listed token are deducted one-for-one; any other fee token stays unknown and is never converted.
/// Symbols match exactly as venues report them (ordinal, case-sensitive). The frontend keeps
/// <c>frontend/src/features/plays/stablecoins.ts</c> in step; a test guards that both lists match.
/// </summary>
public static class NominalStablecoins
{
    public static readonly IReadOnlyList<string> Symbols = ["USDC", "USDG", "USDT", "USDT0", "USDE", "USDe", "USDH"];
    private static readonly HashSet<string> Set = new(Symbols, StringComparer.Ordinal);

    public const string Caveat = "Stablecoin fees and amounts count at nominal 1:1 (USDC, USDG, USDT, USDT0, USDE/USDe, USDH); no FX or depeg valuation.";

    public static bool Contains(string? symbol) => symbol is not null && Set.Contains(symbol);
}

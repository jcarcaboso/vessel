using System.Globalization;

namespace Vessel.Domain.Accounts;

public static class AccountSource
{
    public static bool IsAccountIndex(string? value) =>
        value is { Length: > 0 and <= 19 } &&
        long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var index) &&
        index >= 0 && value == index.ToString(CultureInfo.InvariantCulture);

    public static bool IsEvmAddress(string? value) =>
        value is { Length: 42 } && value.StartsWith("0x", StringComparison.Ordinal) &&
        value.AsSpan(2).IndexOfAnyExcept("0123456789abcdefABCDEF") < 0;
}

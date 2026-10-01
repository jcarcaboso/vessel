using System.Globalization;
using System.Numerics;

namespace Vessel.Application.Workspace;

// Decimal values are exact individually, but decimal addition can round when
// scales differ widely. Keep the nominal display sum exact as an API string.
public static class StablecoinTotals
{
    public static string Sum(IEnumerable<decimal> amounts)
    {
        var scaled = BigInteger.Zero;
        foreach (var amount in amounts)
        {
            var bits = decimal.GetBits(amount);
            var coefficient = (BigInteger)(uint)bits[0] |
                ((BigInteger)(uint)bits[1] << 32) | ((BigInteger)(uint)bits[2] << 64);
            var scale = (bits[3] >> 16) & 0xff;
            if ((bits[3] & int.MinValue) != 0) coefficient = -coefficient;
            scaled += coefficient * BigInteger.Pow(10, 28 - scale);
        }
        var negative = scaled.Sign < 0;
        var whole = BigInteger.DivRem(BigInteger.Abs(scaled), BigInteger.Pow(10, 28), out var remainder);
        var fraction = remainder.ToString(CultureInfo.InvariantCulture).PadLeft(28, '0').TrimEnd('0');
        return (negative ? "-" : "") + whole.ToString(CultureInfo.InvariantCulture) +
            (fraction.Length == 0 ? "" : "." + fraction);
    }
}

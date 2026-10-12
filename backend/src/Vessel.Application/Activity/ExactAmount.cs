using System.Globalization;
using System.Numerics;

namespace Vessel.Application.Activity;

// Fixed 28-place integer arithmetic preserves every retained decimal, even across differing scales.
// Products keep 56 places until division. Only a non-terminating weighted average needs rounding.
internal readonly record struct ExactAmount(BigInteger Units) : IComparable<ExactAmount>
{
    private static readonly BigInteger Factor = BigInteger.Pow(10, 28);
    public static ExactAmount From(decimal value)
    {
        var bits = decimal.GetBits(value);
        var coefficient = (BigInteger)(uint)bits[0] | ((BigInteger)(uint)bits[1] << 32) | ((BigInteger)(uint)bits[2] << 64);
        return new(((bits[3] & int.MinValue) == 0 ? coefficient : -coefficient) * BigInteger.Pow(10, 28 - ((bits[3] >> 16) & 0xff)));
    }
    public static ExactAmount operator +(ExactAmount a, ExactAmount b) => new(a.Units + b.Units);
    public static ExactAmount operator -(ExactAmount a, ExactAmount b) => new(a.Units - b.Units);
    public static ExactAmount operator -(ExactAmount a) => new(-a.Units);
    public ExactAmount Abs() => new(BigInteger.Abs(Units));
    public int CompareTo(ExactAmount other) => Units.CompareTo(other.Units);
    public static string? Average(BigInteger notional, ExactAmount quantity)
    {
        if (quantity.Units.IsZero) return null;
        var quotient = BigInteger.DivRem(notional, quantity.Units, out var remainder);
        if (BigInteger.Abs(remainder) * 2 >= BigInteger.Abs(quantity.Units)) quotient += notional.Sign * quantity.Units.Sign;
        return new ExactAmount(quotient).ToString();
    }
    public override string ToString()
    {
        var whole = BigInteger.DivRem(BigInteger.Abs(Units), Factor, out var remainder);
        var fraction = remainder.ToString(CultureInfo.InvariantCulture).PadLeft(28, '0').TrimEnd('0');
        return (Units.Sign < 0 ? "-" : "") + whole.ToString(CultureInfo.InvariantCulture) + (fraction.Length == 0 ? "" : "." + fraction);
    }
}

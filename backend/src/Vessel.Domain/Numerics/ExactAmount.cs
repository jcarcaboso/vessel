using System.Globalization;
using System.Numerics;

namespace Vessel.Domain.Numerics;

/// <summary>
/// A signed amount as a whole number of 10^-28 units. Fixed 28-place integer arithmetic preserves every retained
/// decimal, even across differing scales, and sums never round or overflow. Products keep 56 places until
/// <see cref="Average"/> divides them; only a non-terminating weighted average needs rounding.
/// </summary>
public readonly record struct ExactAmount(BigInteger Units) : IComparable<ExactAmount>
{
    private static readonly BigInteger Factor = BigInteger.Pow(10, 28);
    public static ExactAmount From(decimal value) => new(ExactDecimal.Units(value));
    /// <summary>
    /// Trusted exact DTO strings, which can exceed decimal's coefficient range after summing. This does not validate:
    /// pass only text this type or <see cref="ExactDecimal.Format(decimal)"/> printed.
    /// </summary>
    public static ExactAmount Parse(string value)
    {
        var negative = value.StartsWith('-');
        var parts = (negative ? value[1..] : value).Split('.');
        var fraction = parts.Length == 2 ? parts[1] : "";
        var units = BigInteger.Parse(parts[0] + fraction.PadRight(28, '0'), CultureInfo.InvariantCulture);
        return new(negative ? -units : units);
    }
    public static ExactAmount operator +(ExactAmount a, ExactAmount b) => new(a.Units + b.Units);
    public static ExactAmount operator -(ExactAmount a, ExactAmount b) => new(a.Units - b.Units);
    public static ExactAmount operator -(ExactAmount a) => new(-a.Units);
    public ExactAmount Abs() => new(BigInteger.Abs(Units));
    public int CompareTo(ExactAmount other) => Units.CompareTo(other.Units);
    /// <summary>A 56-place notional over a quantity, rounded half away from zero to 28 places; null for a zero quantity.</summary>
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

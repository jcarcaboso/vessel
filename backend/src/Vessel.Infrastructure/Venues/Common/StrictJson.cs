using System.Globalization;
using System.Numerics;
using System.Text.Json;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Common;

/// <summary>
/// Strict readers for venue JSON. Every failure is a <see cref="VenueReadException"/> with the venue's own
/// "invalid response" message, so no payload detail reaches logs or clients. Decimals keep their exact text and
/// value: anything a 96-bit coefficient with scale ≤ 28 cannot hold is rejected rather than rounded.
/// </summary>
public sealed class StrictJson(string invalidResponse)
{
    public string InvalidResponse { get; } = invalidResponse;

    public VenueReadException Invalid() => new(InvalidResponse);

    public JsonElement Property(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            throw Invalid();
        return value;
    }

    public JsonElement Array(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
            throw Invalid();
        return element;
    }

    public string Text(JsonElement element, int maxLength = 128)
    {
        if (element.ValueKind != JsonValueKind.String)
            throw Invalid();
        var value = element.GetString()!;
        if (string.IsNullOrWhiteSpace(value) || value.Length > maxLength || value.Any(char.IsControl))
            throw Invalid();
        return value;
    }

    /// <summary>Like <see cref="Text"/>, but an empty string is allowed (some venues send "" for "none").</summary>
    public string TextOrEmpty(JsonElement element, int maxLength = 128)
    {
        if (element.ValueKind != JsonValueKind.String)
            throw Invalid();
        var value = element.GetString()!;
        if (value.Length > maxLength || value.Any(char.IsControl))
            throw Invalid();
        return value;
    }

    public int Integer(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var value))
            throw Invalid();
        return value;
    }

    public bool Boolean(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => throw Invalid()
    };

    /// <summary>A Unix millisecond timestamp, no later than <paramref name="latestTimestamp"/>.</summary>
    public DateTimeOffset Timestamp(JsonElement element, long latestTimestamp)
    {
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt64(out var value) ||
            value < 0 || value > latestTimestamp)
            throw Invalid();
        return DateTimeOffset.FromUnixTimeMilliseconds(value);
    }

    public decimal Positive(JsonElement element)
    {
        var value = Number(element);
        if (value <= 0)
            throw Invalid();
        return value;
    }

    public decimal Nonnegative(JsonElement element)
    {
        var value = Number(element);
        if (value < 0)
            throw Invalid();
        return value;
    }

    /// <summary>A decimal sent as a JSON string.</summary>
    public decimal Number(JsonElement element) => ParseDecimal(Text(element));

    /// <summary>The exact text of a decimal sent as a string, or as a raw JSON number when <paramref name="numbers"/> is set.</summary>
    public string DecimalText(JsonElement element, bool numbers) =>
        numbers && element.ValueKind == JsonValueKind.Number ? element.GetRawText() : Text(element);

    public decimal ParseDecimal(string text)
    {
        var unsigned = text.StartsWith('-') ? text[1..] : text;
        var parts = unsigned.Split('.');
        if (parts.Length > 2 || parts.Any(part => part.Length == 0 || !part.All(char.IsAsciiDigit)))
            throw Invalid();
        var fraction = parts.Length == 2 ? parts[1].TrimEnd('0') : "";
        var coefficient = (parts[0] + fraction).TrimStart('0');
        const string maxCoefficient = "79228162514264337593543950335";
        // decimal.TryParse alone rounds excess precision. Reject values that cannot
        // be represented exactly by a 96-bit coefficient and a scale of at most 28.
        if (fraction.Length > 28 || coefficient.Length > maxCoefficient.Length ||
            (coefficient.Length == maxCoefficient.Length &&
             string.CompareOrdinal(coefficient, maxCoefficient) > 0) ||
            !decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture, out var value))
            throw Invalid();
        return value;
    }

    /// <summary>The value at a common scale, for checking that decimal arithmetic did not round.</summary>
    public static BigInteger DecimalUnits(decimal value)
    {
        var bits = decimal.GetBits(value);
        var coefficient = ((BigInteger)(uint)bits[2] << 64) | ((BigInteger)(uint)bits[1] << 32) | (uint)bits[0];
        var scale = (bits[3] >> 16) & 0xff;
        return coefficient * BigInteger.Pow(10, 28 - scale);
    }

    public void RejectDuplicateProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name))
                    throw Invalid();
                RejectDuplicateProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in element.EnumerateArray())
                RejectDuplicateProperties(child);
        }
    }
}

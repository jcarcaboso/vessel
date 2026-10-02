namespace Vessel.Application.Evidence;

/// <summary>Identifies accepted image formats from their signature; names and declared types are not trusted.</summary>
public static class EvidenceImage
{
    public sealed record Format(string ContentType, string Extension);

    public static readonly Format Png = new("image/png", "png");
    public static readonly Format Jpeg = new("image/jpeg", "jpg");
    public static readonly Format WebP = new("image/webp", "webp");

    public static Format? Detect(ReadOnlySpan<byte> bytes)
    {
        if (bytes.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return Png;
        if (bytes.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF])) return Jpeg;
        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes[8..12].SequenceEqual("WEBP"u8)) return WebP;
        return null;
    }
}

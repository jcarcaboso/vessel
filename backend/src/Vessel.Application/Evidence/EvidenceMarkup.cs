using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Vessel.Application.Workspace;

namespace Vessel.Application.Evidence;

public sealed record MarkupPoint(double X, double Y);

/// <summary>One mark. Which optional fields apply depends on <see cref="Kind"/>; the rest are dropped.</summary>
public sealed record MarkupShape(string Id, string Kind, string Color, double? Width = null, IReadOnlyList<MarkupPoint>? Points = null,
    MarkupPoint? From = null, MarkupPoint? To = null, MarkupPoint? At = null, double? Size = null, string? Text = null);

/// <summary>Vector marks over an evidence image, in natural image pixels. The image bytes are never changed.</summary>
public sealed record ImageMarkup(int Width, int Height, IReadOnlyList<MarkupShape> Shapes);

/// <summary>Validates and normalizes markup before it is stored, so only known shapes and fields persist.</summary>
public static partial class EvidenceMarkup
{
    public const int MaxDimension = 20000;
    public const int MaxShapes = 200;
    public const int MaxPoints = 2000;
    public const int MaxText = 280;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static ImageMarkup Normalize(ImageMarkup? markup)
    {
        if (markup is null) throw Invalid("Markup is required.");
        if (markup.Width is < 1 or > MaxDimension || markup.Height is < 1 or > MaxDimension)
            throw Invalid($"Markup width and height must be 1 to {MaxDimension} pixels.");
        if (markup.Shapes is null || markup.Shapes.Count > MaxShapes) throw Invalid($"Markup holds at most {MaxShapes} shapes.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var shapes = markup.Shapes.Select(shape =>
        {
            if (shape is null) throw Invalid("Markup shapes must not be null.");
            if (shape.Id is null || !IdPattern().IsMatch(shape.Id) || !ids.Add(shape.Id)) throw Invalid("Each mark needs a unique ID.");
            if (shape.Color is null || !ColorPattern().IsMatch(shape.Color)) throw Invalid("Mark colours must be #rrggbb in lowercase.");
            MarkupPoint Point(MarkupPoint? point) => point is not null && point.X >= 0 && point.X <= markup.Width && point.Y >= 0 && point.Y <= markup.Height
                ? point : throw Invalid("Mark points must lie inside the image.");
            double Stroke() => shape.Width is > 0 and <= 1000 ? shape.Width.Value : throw Invalid("Stroke width must be above 0 and at most 1000.");
            return shape.Kind switch
            {
                "pen" or "marker" => new MarkupShape(shape.Id, shape.Kind, shape.Color, Stroke(),
                    shape.Points is { Count: > 0 and <= MaxPoints } points ? points.Select(Point).ToList() : throw Invalid($"Strokes need 1 to {MaxPoints} points.")),
                "arrow" or "box" => new MarkupShape(shape.Id, shape.Kind, shape.Color, Stroke(), From: Point(shape.From), To: Point(shape.To)),
                "text" => new MarkupShape(shape.Id, shape.Kind, shape.Color, At: Point(shape.At),
                    Size: shape.Size is >= 1 and <= 2000 ? shape.Size : throw Invalid("Text size must be 1 to 2000."),
                    Text: shape.Text is { Length: > 0 and <= MaxText } text && !string.IsNullOrWhiteSpace(text) && !text.Any(char.IsControl)
                        ? text : throw Invalid($"Text marks need 1 to {MaxText} characters without control characters.")),
                _ => throw Invalid("Mark kinds are pen, marker, arrow, box and text.")
            };
        }).ToList();
        return new ImageMarkup(markup.Width, markup.Height, shapes);
    }

    /// <summary>Parses markup sent as JSON text, e.g. a multipart form field.</summary>
    public static ImageMarkup Parse(string json)
    {
        try { return Normalize(JsonSerializer.Deserialize<ImageMarkup>(json, Json)); }
        catch (JsonException) { throw Invalid("Markup must be valid JSON."); }
    }

    public static string Serialize(ImageMarkup markup) => JsonSerializer.Serialize(markup, Json);
    public static ImageMarkup? Read(string? stored) => stored is null ? null : JsonSerializer.Deserialize<ImageMarkup>(stored, Json);

    private static WorkspaceException Invalid(string detail) => new(400, detail);

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex IdPattern();
    [GeneratedRegex("^#[0-9a-f]{6}$")]
    private static partial Regex ColorPattern();
}

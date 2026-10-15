using System.Text.RegularExpressions;

namespace Vessel.Infrastructure.Evidence;

internal static partial class EvidenceObjectKey
{
    public static void Validate(string key)
    {
        // Both stores accept only application-generated keys; never normalize client paths.
        if (!KeyPattern().IsMatch(key)) throw new ArgumentException("Invalid evidence object key.", nameof(key));
    }

    [GeneratedRegex(@"\A[a-z0-9]+(/[a-z0-9]+)*\.[a-z0-9]+\z")]
    private static partial Regex KeyPattern();
}

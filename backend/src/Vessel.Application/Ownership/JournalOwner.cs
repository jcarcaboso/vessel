using System.Globalization;

namespace Vessel.Application.Ownership;

/// <summary>
/// The single configured journal owner. Authentication, messaging hosts and tools read the same key and default,
/// so a message owner is always validated against the owner the API authenticates.
/// </summary>
public static class JournalOwner
{
    public const string ConfigurationKey = "Vessel:Auth:OwnerId";
    public static readonly Guid Default = Guid.Parse("11111111-1111-1111-1111-111111111111");

    /// <summary>Parses a configured owner; absent means the default, and an empty or invalid value is rejected.</summary>
    public static Guid Parse(string? configured)
    {
        if (configured is null) return Default;
        if (!Guid.TryParse(configured, CultureInfo.InvariantCulture, out var owner) || owner == Guid.Empty)
            throw new InvalidOperationException("Vessel:Auth:OwnerId must be a non-empty GUID.");
        return owner;
    }
}

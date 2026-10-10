namespace Vessel.Api;

/// <summary>
/// Outside Development, refuse to start without the settings every request needs, instead of running as
/// an installation that only ever answers 401 or 503. Messages name settings, never their values.
/// </summary>
public static class ProductionConfiguration
{
    public const int MinimumTokenLength = 32;

    public static void Validate(IConfiguration config)
    {
        var problems = new List<string>();
        var token = config["Vessel:Auth:Token"];
        if (string.IsNullOrWhiteSpace(token) || token.Trim().Length < MinimumTokenLength)
            problems.Add($"Vessel__Auth__Token must be a generated secret of at least {MinimumTokenLength} characters (for example `openssl rand -base64 48`).");
        if (config["Vessel:Auth:OwnerId"] is { } owner && (!Guid.TryParse(owner, out var id) || id == Guid.Empty))
            problems.Add("Vessel__Auth__OwnerId must be a non-empty GUID.");
        if (string.IsNullOrWhiteSpace(config.GetConnectionString("Vessel")))
            problems.Add("ConnectionStrings__Vessel is required.");
        if (problems.Count > 0)
            throw new InvalidOperationException("Vessel cannot start: " + string.Join(" ", problems));
    }
}

using System.Globalization;

namespace Vessel.Application.Common;

/// <summary>
/// An account scope shared by Overview, Activity and Plays: <c>all</c>, <c>unassigned</c>, <c>portfolio:{id}</c>
/// or <c>account:{id}</c>. Only enabled owner accounts are ever members.
/// </summary>
public readonly record struct ListScope(string Kind, Guid? Id)
{
    public static readonly ListScope All = new("all", null);

    public static ListScope Parse(string? scope)
    {
        scope ??= "all";
        if (scope is "all" or "unassigned") return new(scope, null);
        var parts = scope.Split(':');
        if (parts.Length != 2 || parts[0] is not ("portfolio" or "account") || !Guid.TryParseExact(parts[1], "D", out var id) || id == Guid.Empty)
            throw new ProblemException(400, "Choose all, unassigned, portfolio:<id> or account:<id>.");
        return new(parts[0], id);
    }

    /// <summary>An unknown or foreign portfolio/account is 404, without distinguishing those cases.</summary>
    public void RequireKnown(Func<Guid, bool> portfolioExists, Func<Guid, bool> accountExists)
    {
        if (Kind == "portfolio" && !portfolioExists(Id!.Value)) throw new ProblemException(404, "Portfolio not found.");
        if (Kind == "account" && !accountExists(Id!.Value)) throw new ProblemException(404, "Account not found.");
    }

    public bool Includes(Guid accountId, Guid? portfolioId, bool enabled) => enabled && Kind switch
    {
        "portfolio" => portfolioId == Id,
        "account" => accountId == Id,
        "unassigned" => portfolioId is null,
        _ => true
    };
}

/// <summary>Numbered pages: 1-based <c>page</c>, <c>pageSize</c> 1–100 (default 25); a page past the end is clamped.</summary>
public static class ListPaging
{
    public const int DefaultPageSize = 25, MaxPageSize = 100;

    public static (int Page, int PageSize) Parse(string? page, string? pageSize) =>
        (Number(page, 1, int.MaxValue, 1, "Pages are whole numbers from 1."),
            Number(pageSize, DefaultPageSize, MaxPageSize, 1, $"Page size is a whole number from 1 to {MaxPageSize}."));

    /// <summary>The last page when <paramref name="page"/> is past the end, or 1 when there is nothing.</summary>
    public static int Clamp(int page, int pageSize, int total) => Math.Max(1, Math.Min(page, (int)Math.Ceiling(total / (double)pageSize)));

    public static int Skip(int page, int pageSize) => (int)Math.Min(int.MaxValue, (long)(page - 1) * pageSize);

    private static int Number(string? text, int fallback, int max, int min, string message)
    {
        if (text is null) return fallback;
        return text.Length <= 10 && int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value >= min && value <= max
            ? value : throw new ProblemException(400, message);
    }
}

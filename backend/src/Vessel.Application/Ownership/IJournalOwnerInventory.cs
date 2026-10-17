namespace Vessel.Application.Ownership;

/// <summary>
/// Read-only list of every owner ID that has journal data, including owners whose only data has no event cursor.
/// Implemented by journal persistence over raw SQL (no owner filter, no owner scope); used by offline identity
/// checks (`identity verify`) so the identity module never queries journal tables itself.
/// </summary>
public interface IJournalOwnerInventory
{
    /// <summary>Distinct owner IDs in ascending order after <paramref name="after"/> (exclusive), at most <paramref name="limit"/> (1–1000).</summary>
    Task<IReadOnlyList<Guid>> DistinctOwnersAsync(Guid? after, int limit, CancellationToken cancellationToken);
}

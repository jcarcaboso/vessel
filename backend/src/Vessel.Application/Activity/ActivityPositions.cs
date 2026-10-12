using Vessel.Domain.Workspace;

namespace Vessel.Application.Activity;

internal readonly record struct ActivityContractKey(Guid AccountId, string Identity)
{
    public static ActivityContractKey From(ImportedFill fill) => new(fill.AccountId, fill.VenueContractId ?? fill.ContractId);
}

/// <summary>One shared index for anchoring and comparison, including legacy snapshot identities.</summary>
internal sealed class ActivityPositions
{
    public const string AmbiguousIdentityNotice = "Snapshot native contract identity is missing or ambiguous; this position cannot anchor or compare multiple markets sharing a canonical key.";
    public IReadOnlyDictionary<Guid, AccountSnapshot> Snapshots { get; }
    public Dictionary<ActivityContractKey, string> Contracts { get; } = [];
    private readonly Dictionary<ActivityContractKey, ExactAmount?> quantities = [];

    public ActivityPositions(IReadOnlyList<ImportedFill> fills, IReadOnlyList<AccountSnapshot> snapshots)
    {
        Snapshots = snapshots.ToDictionary(s => s.AccountId);
        var candidates = fills.Select(f => (f.AccountId, f.ContractId, Key: ActivityContractKey.From(f)))
            .Concat(Snapshots.Values.SelectMany(s => s.Positions.Where(p => p.VenueContractId is not null)
                .Select(p => (s.AccountId, p.ContractId, Key: new ActivityContractKey(s.AccountId, p.VenueContractId!)))))
            .GroupBy(p => (p.AccountId, p.ContractId))
            .ToDictionary(g => g.Key, g => g.Select(p => p.Key).Distinct().ToArray());
        foreach (var fill in fills) Contracts[ActivityContractKey.From(fill)] = fill.ContractId;
        foreach (var snapshot in Snapshots.Values)
        foreach (var position in snapshot.Positions)
        {
            var keys = position.VenueContractId is { } native
                ? [new ActivityContractKey(snapshot.AccountId, native)]
                : candidates.GetValueOrDefault((snapshot.AccountId, position.ContractId))
                    ?? [new ActivityContractKey(snapshot.AccountId, position.ContractId)];
            foreach (var key in keys)
            {
                Contracts[key] = position.ContractId;
                // Never assign one legacy position to several native markets.
                if (!quantities.TryAdd(key, keys.Length == 1 ? ExactAmount.From(position.SignedQuantity) : null))
                    quantities[key] = null;
            }
        }
    }

    // A contract absent from a coherent snapshot is flat. A present but ambiguous identity is unknown.
    public ExactAmount? Quantity(ActivityContractKey key) => quantities.TryGetValue(key, out var quantity) ? quantity : default(ExactAmount);
}

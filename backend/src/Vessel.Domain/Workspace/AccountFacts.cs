namespace Vessel.Domain.Workspace;

// Only the latest coherent observation is retained. Unknown balances remain null.
public sealed class AccountSnapshot
{
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public DateTimeOffset ObservedAtUtc { get; set; }
    public string ValueScope { get; set; } = null!;
    public decimal? AccountValueUsd { get; set; }
    public decimal? WithdrawableUsd { get; set; }
    public decimal? MarginUsedUsd { get; set; }
    public List<AccountPosition> Positions { get; set; } = [];
    public DateTimeOffset? StablecoinsObservedAtUtc { get; set; }
    public string? AccountMode { get; set; }
    public string? StablecoinScope { get; set; }
    public List<AccountStablecoin> Stablecoins { get; set; } = [];
}

public sealed class AccountStablecoin
{
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public int TokenIndex { get; set; }
    public string TokenId { get; set; } = null!;
    public string Symbol { get; set; } = null!;
    public decimal Total { get; set; }
    public decimal Held { get; set; }
    public decimal Available { get; set; }
}

public sealed class AccountPosition
{
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public string ContractId { get; set; } = null!;
    public decimal SignedQuantity { get; set; }
    public decimal EntryPrice { get; set; }
    public decimal UnrealizedPnlUsd { get; set; }
    public decimal MarginUsedUsd { get; set; }
    public int? Leverage { get; set; }
}

public sealed class ImportedFill
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public string ContractId { get; set; } = null!;
    public string SourceFillId { get; set; } = null!;
    public string Side { get; set; } = null!;
    public string Direction { get; set; } = null!;
    public decimal Price { get; set; }
    public decimal Quantity { get; set; }
    public decimal Fee { get; set; }
    public string FeeToken { get; set; } = null!;
    public decimal ClosedPnlUsd { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
    public string OrderId { get; set; } = null!;
    public string TransactionHash { get; set; } = null!;
}

// The latest known state of a venue order that could belong to a Play. A fact, not trading intent.
public sealed class ImportedOrder
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public string ContractId { get; set; } = null!;
    public string OrderId { get; set; } = null!;
    public string Side { get; set; } = null!;
    public string OrderType { get; set; } = null!;
    public decimal LimitPrice { get; set; }
    public decimal? TriggerPrice { get; set; }
    public bool ReduceOnly { get; set; }
    public bool IsPositionTpsl { get; set; }
    public decimal OriginalSize { get; set; }
    public decimal RemainingSize { get; set; }
    public DateTimeOffset PlacedAtUtc { get; set; }
    /// <summary>open, filled, triggered, canceled, rejected or other.</summary>
    public string Status { get; set; } = null!;
    public string VenueStatus { get; set; } = null!;
    public DateTimeOffset StatusAtUtc { get; set; }
    public DateTimeOffset ObservedAtUtc { get; set; }
}

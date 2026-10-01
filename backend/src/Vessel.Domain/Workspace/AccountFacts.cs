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

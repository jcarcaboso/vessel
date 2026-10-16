using Vessel.Domain.Common;

namespace Vessel.Domain.Workspace;

public static class FundingFacts
{
    /// <summary>Whether the venue's reported execution P&amp;L already includes settled funding.</summary>
    public const string Excluded = "excluded", Included = "included", Unknown = "unknown";
    public static bool IsPnlBasis(string? value) => value is Excluded or Included or Unknown;
}

/// <summary>An actual venue settlement, independent of an execution or Play association.</summary>
public sealed class FundingPayment : IOwned
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public string SourceId { get; set; } = null!;
    public string ContractId { get; set; } = null!;
    public string? VenueContractId { get; set; }
    public decimal Amount { get; set; }
    public string Asset { get; set; } = null!;
    public DateTimeOffset OccurredAtUtc { get; set; }
    // Some venues report nanoseconds. PostgreSQL timestamps retain microseconds; keep the original instant too.
    public long? OccurredAtUnixNanoseconds { get; set; }
}

/// <summary>One verified contiguous history window plus the latest read's coverage, never inferred from payment count.</summary>
public sealed class AccountFundingState : IOwned
{
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public DateTimeOffset? CoveredFromUtc { get; set; }
    public DateTimeOffset? CoveredToUtc { get; set; }
    public DateTimeOffset LastAttemptFromUtc { get; set; }
    public DateTimeOffset LastAttemptToUtc { get; set; }
    public bool LastReadComplete { get; set; }
    public string PnlBasis { get; set; } = FundingFacts.Unknown;
    public string Notice { get; set; } = null!;
}

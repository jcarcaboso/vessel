using System.Text.Json;
using Vessel.Domain.Common;

namespace Vessel.Domain.Plays;

public sealed class PlayReviewRevision : IOwned
{
    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public Guid PlayId { get; private set; }
    public int Number { get; private set; }
    public DateTimeOffset OccurredAtUtc { get; private set; }
    public string Review { get; private set; } = "";
    public string StructuredReview { get; private set; } = "{}";
    private PlayReviewRevision() { }
    internal PlayReviewRevision(Play play, int number, DateTimeOffset now)
    {
        Id = Guid.NewGuid(); OwnerId = play.OwnerId; PlayId = play.Id; Number = number;
        OccurredAtUtc = now; Review = play.Review;
        StructuredReview = JsonSerializer.Serialize(play.Answers);
    }
}

// These are owner-entered facts. They are never inserted into imported_orders or imported_fills.
public sealed class ManualExecution : IOwned
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public Guid PlayId { get; set; }
    public string Role { get; set; } = null!;
    public string? EntryId { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
    public string Side { get; set; } = null!;
    public string Quantity { get; set; } = null!;
    public string Price { get; set; } = null!;
    public string? Fee { get; set; }
    public string? FeeCurrency { get; set; }
    public string Source { get; set; } = null!;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class ManualExecutionHistory : IOwned
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public Guid PlayId { get; set; }
    public Guid ExecutionId { get; set; }
    public string? Reason { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
    public string? Before { get; set; }
    public string After { get; set; } = null!;
}

// The response snapshot makes a retry return the original result, even after later mutations.
public sealed class DiaryRequest : IOwned
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public string PayloadHash { get; set; } = null!;
    public string Response { get; set; } = null!;
}

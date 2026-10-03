namespace Vessel.Domain.Plays;

public enum OrderLinkRole { Entry, Stop, Target, Exit }
/// <summary>Linked counts toward the Play; Suggested waits for the owner; Dismissed is never proposed again.</summary>
public enum OrderLinkState { Linked, Suggested, Dismissed }
public enum OrderLinkSource { Automatic, Owner }

/// <summary>
/// Ties a venue order to one level of a Play: an entry, one of its stops or targets, or an unplanned exit.
/// Fills reach a Play only through linked orders.
/// </summary>
public sealed class PlayOrderLink
{
    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public Guid PlayId { get; private set; }
    public Guid AccountId { get; private set; }
    public string OrderId { get; private set; } = null!;
    public OrderLinkRole Role { get; private set; }
    /// <summary>Plan entry ID; null for an unplanned exit.</summary>
    public string? EntryId { get; private set; }
    /// <summary>Stop or target ID within the entry for stop and target links; null for entries and exits.</summary>
    public string? LevelId { get; private set; }
    public OrderLinkState State { get; private set; }
    public OrderLinkSource Source { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    private PlayOrderLink() { }

    public PlayOrderLink(Play play, string orderId, OrderLinkRole role, string? entryId, string? levelId,
        OrderLinkState state, OrderLinkSource source, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(play);
        ArgumentException.ThrowIfNullOrWhiteSpace(orderId);
        if ((role == OrderLinkRole.Exit) != (entryId is null) || (role is OrderLinkRole.Stop or OrderLinkRole.Target) != (levelId is not null))
            throw new ArgumentException("The level does not fit the link role.");
        Id = Guid.NewGuid();
        OwnerId = play.OwnerId;
        PlayId = play.Id;
        AccountId = play.AccountId;
        OrderId = orderId;
        Role = role;
        EntryId = entryId;
        LevelId = levelId;
        State = state;
        Source = source;
        CreatedAtUtc = now;
        UpdatedAtUtc = now;
    }

    /// <summary>Identifies the level within the Play, e.g. <c>target|entry-1|t-2</c>.</summary>
    public string LevelKey => Key(Role, EntryId, LevelId);

    public static string Key(OrderLinkRole role, string? entryId, string? levelId) => role switch
    {
        OrderLinkRole.Exit => "exit",
        OrderLinkRole.Entry => $"entry|{entryId}",
        _ => $"{role.ToString().ToLowerInvariant()}|{entryId}|{levelId}"
    };

    /// <summary>A suggestion that became the only candidate, e.g. after the owner declined the others.</summary>
    public void LinkAutomatically(DateTimeOffset now) { State = OrderLinkState.Linked; Source = OrderLinkSource.Automatic; UpdatedAtUtc = now; }
    public void Confirm(DateTimeOffset now) { State = OrderLinkState.Linked; Source = OrderLinkSource.Owner; UpdatedAtUtc = now; }
    public void Dismiss(DateTimeOffset now) { State = OrderLinkState.Dismissed; Source = OrderLinkSource.Owner; UpdatedAtUtc = now; }
}

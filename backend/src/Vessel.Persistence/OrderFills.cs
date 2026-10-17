using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence;

/// <summary>A link's fill: the link, its order and one fill of that order. Member-initialized so queries can compose on it.</summary>
public sealed class LinkedFillRow
{
    public PlayOrderLink Link { get; init; } = null!;
    public ImportedOrder Order { get; init; } = null!;
    public ImportedFill Fill { get; init; } = null!;
}

/// <summary>A link with its order. Member-initialized so queries can compose on it.</summary>
public sealed class LinkedOrderRow
{
    public PlayOrderLink Link { get; init; } = null!;
    public ImportedOrder Order { get; init; } = null!;
}

/// <summary>
/// The one SQL rule that ties fills to orders. Fills carry no order reference: a fill belongs to the order with the same
/// owner, account, contract and external order ID (the Application's <c>OrderKey</c>). Never join fills on the external
/// ID alone.
/// </summary>
public static class OrderFills
{
    /// <summary>Fills of <paramref name="orders"/>. Order keys are unique, so a fill appears at most once.</summary>
    public static IQueryable<ImportedFill> FillsOf(this VesselDbContext db, IQueryable<ImportedOrder> orders) =>
        orders.Join(db.Fills,
            o => new { o.OwnerId, o.AccountId, o.ContractId, o.ExternalOrderId },
            f => new { f.OwnerId, f.AccountId, f.ContractId, f.ExternalOrderId },
            (o, f) => f);

    /// <summary>Each link with its order, on the composite owner/account/internal ID foreign key.</summary>
    public static IQueryable<LinkedOrderRow> LinkedOrders(this VesselDbContext db, IQueryable<PlayOrderLink> links) =>
        links.Join(db.Orders,
            l => new { l.OwnerId, l.AccountId, Id = l.ImportedOrderId },
            o => new { o.OwnerId, o.AccountId, o.Id },
            (l, o) => new LinkedOrderRow { Link = l, Order = o });

    /// <summary>Link → order → fills: each fill of each link's order, once per link.</summary>
    public static IQueryable<LinkedFillRow> LinkedFills(this VesselDbContext db, IQueryable<PlayOrderLink> links) =>
        links.Join(db.Orders,
                l => new { l.OwnerId, l.AccountId, Id = l.ImportedOrderId },
                o => new { o.OwnerId, o.AccountId, o.Id },
                (l, o) => new { Link = l, Order = o })
            .Join(db.Fills,
                x => new { x.Order.OwnerId, x.Order.AccountId, x.Order.ContractId, x.Order.ExternalOrderId },
                f => new { f.OwnerId, f.AccountId, f.ContractId, f.ExternalOrderId },
                (x, f) => new LinkedFillRow { Link = x.Link, Order = x.Order, Fill = f });
}

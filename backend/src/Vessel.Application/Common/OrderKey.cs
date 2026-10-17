using Vessel.Domain.Workspace;

namespace Vessel.Application.Common;

/// <summary>
/// The external identity of a venue order: the venue's order ID is unique within an account and contract, never
/// across them. Fills carry no order reference; a fill belongs to the order with the same key. This is the one
/// in-memory grouping rule (Persistence's <c>LinkedFills</c> is the SQL form); never group fills by the external ID alone.
/// </summary>
public readonly record struct OrderKey(Guid AccountId, string ContractId, string ExternalOrderId)
{
    public static OrderKey Of(ImportedOrder order)
    {
        ArgumentNullException.ThrowIfNull(order);
        return new(order.AccountId, order.ContractId, order.ExternalOrderId);
    }

    public static OrderKey Of(ImportedFill fill)
    {
        ArgumentNullException.ThrowIfNull(fill);
        return new(fill.AccountId, fill.ContractId, fill.ExternalOrderId);
    }
}

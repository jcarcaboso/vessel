using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence.Events;

/// <summary>Capture writes before EF accepts their original values, including intermediate saves.</summary>
public sealed class VesselEventMutationCapture : SaveChangesInterceptor
{
    internal List<PlayStatusChange> StatusChanges { get; } = [];
    internal List<LinkMutation> Links { get; } = [];
    internal HashSet<(Guid AccountId, string OrderId)> FillOrders { get; } = [];

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
        InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Capture((VesselDbContext)eventData.Context!);
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Capture((VesselDbContext)eventData.Context!);
        return result;
    }

    private void Capture(VesselDbContext db)
    {
        if (db.Database.CurrentTransaction is null) return;
        // Unrelated stores (for example evidence metadata) keep their own short transactions.
        // Require the event boundary only when a mutation is actually going to be captured.
        foreach (var entry in db.ChangeTracker.Entries<PlayStatusChange>().Where(e => e.State == EntityState.Added))
        {
            VesselEventSql.RequireTransaction(db);
            if (entry.Entity.OwnerId != db.CurrentOwnerId) throw new UnauthorizedAccessException();
            if (StatusChanges.All(x => x.Id != entry.Entity.Id)) StatusChanges.Add(entry.Entity);
        }
        foreach (var entry in db.ChangeTracker.Entries<PlayOrderLink>()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            var link = entry.Entity;
            if (link.OwnerId != db.CurrentOwnerId) throw new UnauthorizedAccessException();
            var previous = entry.State == EntityState.Added ? null :
                entry.OriginalValues.GetValue<OrderLinkState>(nameof(link.State)).ToString().ToLowerInvariant();
            var current = entry.State == EntityState.Deleted ? "unlinked" : link.State.ToString().ToLowerInvariant();
            if (entry.State == EntityState.Modified && previous == current &&
                entry.OriginalValues.GetValue<OrderLinkSource>(nameof(link.Source)) == link.Source) continue;
            VesselEventSql.RequireTransaction(db);
            Links.Add(new(Guid.CreateVersion7(), link.Id, link.AccountId, link.PlayId, link.OrderId, link.Role,
                link.EntryId, link.LevelId, previous, current, link.Source, link.UpdatedAtUtc));
            FillOrders.Add((link.AccountId, link.OrderId));
        }
        foreach (var entry in db.ChangeTracker.Entries<ImportedFill>().Where(e => e.State == EntityState.Added))
        {
            VesselEventSql.RequireTransaction(db);
            if (entry.Entity.OwnerId != db.CurrentOwnerId) throw new UnauthorizedAccessException();
            FillOrders.Add((entry.Entity.AccountId, entry.Entity.OrderId));
        }
        // v1 observes venue fills. Manual P1 facts/corrections emit their resulting status changes only.
    }

    internal void Clear()
    {
        StatusChanges.Clear(); Links.Clear(); FillOrders.Clear();
    }

    internal sealed record LinkMutation(Guid ChangeId, Guid LinkId, Guid AccountId, Guid PlayId, string OrderId,
        OrderLinkRole Role, string? EntryId, string? LevelId, string? Previous, string Current,
        OrderLinkSource Source, DateTimeOffset OccurredAt);
}

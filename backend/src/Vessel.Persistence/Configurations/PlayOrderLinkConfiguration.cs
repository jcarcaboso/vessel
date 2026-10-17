using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence.Configurations;

internal sealed class PlayOrderLinkConfiguration : IEntityTypeConfiguration<PlayOrderLink>
{
    public void Configure(EntityTypeBuilder<PlayOrderLink> builder)
    {
        builder.ToTable("play_order_links");
        builder.HasKey(x => x.Id);
        builder.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        // The order of the link's own owner and account. Account deletion is blocked while any Play exists and Play
        // deletion removes links first, so an order with links is never deleted.
        builder.HasOne<ImportedOrder>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId, x.ImportedOrderId })
            .HasPrincipalKey(x => new { x.OwnerId, x.AccountId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.Ignore(x => x.LevelKey);
        builder.Property(x => x.EntryId).HasMaxLength(64);
        builder.Property(x => x.LevelId).HasMaxLength(64);
        builder.Property(x => x.Role).HasConversion<string>().HasMaxLength(16);
        builder.Property(x => x.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(x => new { x.OwnerId, x.AccountId, x.ImportedOrderId });
        builder.HasIndex(x => new { x.OwnerId, x.PlayId });
        // An order counts toward at most one level of one Play.
        builder.HasIndex(x => new { x.OwnerId, x.ImportedOrderId }).IsUnique()
            .HasDatabaseName("UX_play_order_links_linked_order").HasFilter("\"State\" = 'Linked'");
    }
}

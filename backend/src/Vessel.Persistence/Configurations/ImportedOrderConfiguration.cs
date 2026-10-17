using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence.Configurations;

internal sealed class ImportedOrderConfiguration : IEntityTypeConfiguration<ImportedOrder>
{
    public void Configure(EntityTypeBuilder<ImportedOrder> builder)
    {
        builder.ToTable("imported_orders", table => table.HasCheckConstraint("CK_imported_orders_side", "\"Side\" IN ('buy', 'sell')"));
        builder.HasKey(x => x.Id);
        builder.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        // External identity: the venue's order ID is unique per account and contract, never across them.
        builder.HasIndex(x => new { x.OwnerId, x.AccountId, x.ContractId, x.ExternalOrderId }).IsUnique();
        // Links reference an order within its owner and account (PlayOrderLinkConfiguration).
        builder.HasAlternateKey(x => new { x.OwnerId, x.AccountId, x.Id });
        builder.Property(x => x.ContractId).HasMaxLength(128);
        builder.Property(x => x.ExternalOrderId).HasMaxLength(128);
        builder.Property(x => x.VenueContractId).HasMaxLength(128);
        builder.Property(x => x.Side).HasMaxLength(8);
        builder.Property(x => x.OrderType).HasMaxLength(32);
        builder.Property(x => x.Status).HasMaxLength(16);
        builder.Property(x => x.VenueStatus).HasMaxLength(64);
    }
}

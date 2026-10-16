using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence.Configurations;

internal sealed class FundingPaymentConfiguration : IEntityTypeConfiguration<FundingPayment>
{
    public void Configure(EntityTypeBuilder<FundingPayment> builder)
    {
        builder.ToTable("funding_payments");
        builder.HasKey(x => x.Id);
        builder.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(x => new { x.OwnerId, x.AccountId, x.SourceId }).IsUnique();
        builder.HasIndex(x => new { x.OwnerId, x.AccountId, x.OccurredAtUtc });
        builder.Property(x => x.SourceId).HasMaxLength(128);
        builder.Property(x => x.ContractId).HasMaxLength(128);
        builder.Property(x => x.VenueContractId).HasMaxLength(128);
        builder.Property(x => x.Asset).HasMaxLength(64);
    }
}

internal sealed class AccountFundingStateConfiguration : IEntityTypeConfiguration<AccountFundingState>
{
    public void Configure(EntityTypeBuilder<AccountFundingState> builder)
    {
        builder.ToTable("account_funding_states", table =>
        {
            table.HasCheckConstraint("CK_account_funding_states_basis", "\"PnlBasis\" IN ('excluded', 'included', 'unknown')");
            table.HasCheckConstraint("CK_account_funding_states_window",
                """("CoveredFromUtc" IS NULL AND "CoveredToUtc" IS NULL OR "CoveredFromUtc" IS NOT NULL AND "CoveredToUtc" IS NOT NULL AND "CoveredFromUtc" <= "CoveredToUtc") AND "LastAttemptFromUtc" <= "LastAttemptToUtc" """);
        });
        builder.HasKey(x => new { x.OwnerId, x.AccountId });
        builder.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.Property(x => x.PnlBasis).HasMaxLength(16);
        builder.Property(x => x.Notice).HasMaxLength(2000);
    }
}

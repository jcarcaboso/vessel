using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Vessel.Domain.Accounts;
using Vessel.Domain.Credentials;

namespace Vessel.Persistence.Configurations;

internal sealed class AccountCredentialConfiguration : IEntityTypeConfiguration<AccountCredential>
{
    public void Configure(EntityTypeBuilder<AccountCredential> builder)
    {
        builder.ToTable("account_credentials", table =>
        {
            table.HasCheckConstraint("CK_account_credentials_envelope",
                """octet_length("Nonce") = 12 AND octet_length("Tag") = 16 AND octet_length("Ciphertext") BETWEEN 1 AND 2048""");
            table.HasCheckConstraint("CK_account_credentials_scope", "\"Scope\" IN ('single', 'all')");
        });
        builder.HasKey(x => new { x.OwnerId, x.AccountId, x.Purpose });
        builder.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Cascade);
        builder.Property(x => x.Purpose).HasMaxLength(128);
        builder.Property(x => x.KeyId).HasMaxLength(64);
        builder.Property(x => x.Scope).HasMaxLength(16);
        builder.Property(x => x.LastError).HasMaxLength(32);
    }
}

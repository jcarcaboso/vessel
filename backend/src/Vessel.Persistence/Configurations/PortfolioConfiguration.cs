using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence.Configurations;

internal sealed class PortfolioConfiguration : IEntityTypeConfiguration<Portfolio>
{
    public void Configure(EntityTypeBuilder<Portfolio> builder)
    {
        builder.ToTable("portfolios");
        builder.HasKey(x => x.Id);
        builder.HasAlternateKey(x => new { x.OwnerId, x.Id });
        builder.Property(x => x.Name).HasMaxLength(200);
        builder.Property(x => x.Icon).HasMaxLength(PortfolioIcons.MaxLength).HasDefaultValue(PortfolioIcons.Default);
    }
}

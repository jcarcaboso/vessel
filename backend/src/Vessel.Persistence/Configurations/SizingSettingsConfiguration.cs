using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Vessel.Domain.Sizing;

namespace Vessel.Persistence.Configurations;

internal sealed class SizingSettingsConfiguration : IEntityTypeConfiguration<SizingSettings>
{
    public void Configure(EntityTypeBuilder<SizingSettings> builder)
    {
        builder.ToTable("sizing_settings", table => table.HasCheckConstraint("CK_sizing_settings_risk",
            "\"RiskPercent\" >= 0.1 AND \"RiskPercent\" <= 5"));
        builder.HasKey(x => x.OwnerId);
        builder.Property(x => x.RiskPercent).HasPrecision(5, 2);
    }
}

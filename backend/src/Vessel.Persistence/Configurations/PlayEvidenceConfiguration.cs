using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Vessel.Domain.Evidence;
using Vessel.Domain.Plays;

namespace Vessel.Persistence.Configurations;

internal sealed class PlayEvidenceConfiguration : IEntityTypeConfiguration<PlayEvidence>
{
    public void Configure(EntityTypeBuilder<PlayEvidence> builder)
    {
        builder.ToTable("play_evidence", table =>
        {
            table.HasCheckConstraint("CK_play_evidence_size", "\"SizeBytes\" > 0");
            table.HasCheckConstraint("CK_play_evidence_sha256", "\"Sha256\" ~ '^[0-9a-f]{64}$'");
        });
        builder.HasKey(x => x.Id);
        // Deleting a Play must deal with its stored images explicitly, so it never cascades.
        builder.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(x => new { x.OwnerId, x.PlayId, x.CreatedAtUtc });
        builder.HasIndex(x => x.ObjectKey).IsUnique();
        builder.Property(x => x.ObjectKey).HasMaxLength(256);
        builder.Property(x => x.ContentType).HasMaxLength(64);
        builder.Property(x => x.Sha256).HasMaxLength(64).IsFixedLength();
        builder.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
        builder.Property(x => x.Note).HasMaxLength(PlayEvidence.MaxNoteLength);
        builder.Property(x => x.Markup).HasColumnType("jsonb");
    }
}

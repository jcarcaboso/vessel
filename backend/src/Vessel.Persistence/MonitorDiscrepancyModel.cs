using Microsoft.EntityFrameworkCore;
using Vessel.Domain.Accounts;
using Vessel.Domain.Monitoring;
using Vessel.Domain.Plays;

namespace Vessel.Persistence;

public static class MonitorDiscrepancyModel
{
    public static void Configure(ModelBuilder model)
    {
        var row = model.Entity<PlayDiscrepancy>();
        row.ToTable("play_discrepancies", table =>
        {
            table.HasCheckConstraint("CK_discrepancy_state", "\"State\" IN ('candidate','open','resolved','dismissed')");
            table.HasCheckConstraint("CK_discrepancy_severity", "\"Severity\" IN ('info','warning','critical')");
            table.HasCheckConstraint("CK_discrepancy_published",
                "\"PublishedTransition\" IS NULL OR \"PublishedTransition\" IN ('opened','resolved','dismissed','unverifiable')");
        });
        row.HasKey(x => x.Id);
        row.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Cascade);
        row.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Cascade);
        row.Property(x => x.ContractId).HasMaxLength(200);
        row.Property(x => x.NativeContractId).HasMaxLength(200);
        row.Property(x => x.SubjectKey).HasMaxLength(1000);
        row.Property(x => x.Kind).HasMaxLength(64);
        row.Property(x => x.Severity).HasMaxLength(16);
        row.Property(x => x.State).HasMaxLength(16);
        row.Property(x => x.Fingerprint).HasMaxLength(64);
        row.Property(x => x.PendingFingerprint).HasMaxLength(64);
        row.Property(x => x.PublishedTransition).HasMaxLength(16);
        row.Property(x => x.Note).HasMaxLength(PlayDiscrepancy.MaxNoteLength);
        row.Property(x => x.Details).HasColumnType("jsonb");
        row.Property(x => x.Revision).IsConcurrencyToken();
        // Reuse a resolved row; event history retains each opened/resolved lifecycle independently.
        row.HasIndex(x => new { x.OwnerId, x.AccountId, x.Kind, x.SubjectKey }).IsUnique();
    }
}

using Microsoft.EntityFrameworkCore;
using Vessel.Application.Ownership;
using Vessel.Domain.Accounts;
using Vessel.Domain.Evidence;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence;

public sealed class VesselDbContext(DbContextOptions<VesselDbContext> options, IJournalOwnerContext owner)
    : DbContext(options)
{
    public Guid CurrentOwnerId => owner.OwnerId;
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<Play> Plays => Set<Play>();
    public DbSet<Portfolio> Portfolios => Set<Portfolio>();
    public DbSet<AccountSnapshot> Snapshots => Set<AccountSnapshot>();
    public DbSet<AccountPosition> Positions => Set<AccountPosition>();
    public DbSet<AccountStablecoin> Stablecoins => Set<AccountStablecoin>();
    public DbSet<ImportedFill> Fills => Set<ImportedFill>();
    public DbSet<PlayEvidence> Evidence => Set<PlayEvidence>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var account = modelBuilder.Entity<Account>();
        account.ToTable("accounts", table =>
        {
            table.HasCheckConstraint("CK_accounts_normalized_address", "\"Address\" IS NULL OR \"Address\" = lower(\"Address\")");
            table.HasCheckConstraint("CK_accounts_settings_revision", "\"SettingsRevision\" >= 1");
        });
        account.HasKey(x => x.Id);
        account.HasAlternateKey(x => new { x.OwnerId, x.Id });
        account.Property(x => x.VenueId).HasMaxLength(64);
        account.Property(x => x.Name).HasMaxLength(200);
        account.HasQueryFilter(x => x.OwnerId == CurrentOwnerId);

        var portfolio = modelBuilder.Entity<Portfolio>();
        portfolio.ToTable("portfolios");
        portfolio.HasKey(x => x.Id);
        portfolio.HasAlternateKey(x => new { x.OwnerId, x.Id });
        portfolio.Property(x => x.Name).HasMaxLength(200);
        portfolio.HasQueryFilter(x => x.OwnerId == CurrentOwnerId);
        account.HasOne<Portfolio>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PortfolioId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        account.HasIndex(x => new { x.OwnerId, x.VenueId, x.Address }).IsUnique()
            .HasDatabaseName("UX_accounts_owner_venue_address").HasFilter("\"Address\" IS NOT NULL");
        account.Property(x => x.SettingsRevision).HasDefaultValue(1L);
        // With a database default, EF omits a property equal to its sentinel. A true
        // sentinel keeps an explicitly disabled new account from being stored as enabled.
        account.Property(x => x.IsEnabled).HasDefaultValue(true).HasSentinel(true);
        account.Property(x => x.Address).HasMaxLength(42);
        account.Property(x => x.SyncStatus).HasMaxLength(32);
        account.Property(x => x.LastSyncError).HasMaxLength(200);
        account.Property(x => x.HistoryNotice).HasMaxLength(1000);

        var snapshot = modelBuilder.Entity<AccountSnapshot>();
        snapshot.ToTable("account_snapshots");
        snapshot.HasKey(x => new { x.OwnerId, x.AccountId });
        snapshot.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        snapshot.HasQueryFilter(x => x.OwnerId == CurrentOwnerId);
        snapshot.Property(x => x.ValueScope).HasMaxLength(128);
        snapshot.Property(x => x.AccountMode).HasMaxLength(64);
        snapshot.Property(x => x.StablecoinScope).HasMaxLength(128);
        var stablecoin = modelBuilder.Entity<AccountStablecoin>();
        stablecoin.ToTable("account_stablecoins");
        stablecoin.HasKey(x => new { x.OwnerId, x.AccountId, x.TokenId });
        stablecoin.Property(x => x.TokenId).HasMaxLength(64);
        stablecoin.Property(x => x.Symbol).HasMaxLength(32);
        snapshot.HasMany(x => x.Stablecoins).WithOne().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .OnDelete(DeleteBehavior.Cascade);
        stablecoin.HasQueryFilter(x => x.OwnerId == CurrentOwnerId);
        var position = modelBuilder.Entity<AccountPosition>();
        position.ToTable("account_positions");
        position.HasKey(x => new { x.OwnerId, x.AccountId, x.ContractId });
        position.Property(x => x.ContractId).HasMaxLength(128);
        snapshot.HasMany(x => x.Positions).WithOne().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .OnDelete(DeleteBehavior.Cascade);
        position.HasQueryFilter(x => x.OwnerId == CurrentOwnerId);

        var fill = modelBuilder.Entity<ImportedFill>();
        fill.ToTable("imported_fills");
        fill.HasKey(x => x.Id);
        fill.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        fill.HasQueryFilter(x => x.OwnerId == CurrentOwnerId);
        fill.HasIndex(x => new { x.OwnerId, x.AccountId, x.ContractId, x.SourceFillId }).IsUnique();
        fill.HasIndex(x => new { x.OwnerId, x.OccurredAtUtc });
        fill.Property(x => x.ContractId).HasMaxLength(128);
        fill.Property(x => x.SourceFillId).HasMaxLength(128);
        fill.Property(x => x.Side).HasMaxLength(32);
        fill.Property(x => x.Direction).HasMaxLength(128);
        fill.Property(x => x.FeeToken).HasMaxLength(64);
        fill.Property(x => x.OrderId).HasMaxLength(128);
        fill.Property(x => x.TransactionHash).HasMaxLength(256);
        // Unconstrained PostgreSQL numeric preserves every .NET decimal digit and scale.
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                if (property.ClrType == typeof(decimal) || property.ClrType == typeof(decimal?))
                    property.SetColumnType("numeric");

        var play = modelBuilder.Entity<Play>();
        play.ToTable("plays");
        play.HasKey(x => x.Id);
        play.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
        play.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        play.HasQueryFilter(x => x.OwnerId == CurrentOwnerId);
        play.Ignore(x => x.Instrument);
        play.Property(x => x.VenueId).HasMaxLength(64);
        play.Property(x => x.ContractId).HasMaxLength(128);
        // Deliberately non-unique. Distinct active ideas can share a venue position.
        play.HasIndex(x => new { x.OwnerId, x.AccountId, x.VenueId, x.ContractId });
        play.HasAlternateKey(x => new { x.OwnerId, x.Id });

        var evidence = modelBuilder.Entity<PlayEvidence>();
        evidence.ToTable("play_evidence", table =>
        {
            table.HasCheckConstraint("CK_play_evidence_size", "\"SizeBytes\" > 0");
            table.HasCheckConstraint("CK_play_evidence_sha256", "\"Sha256\" ~ '^[0-9a-f]{64}$'");
        });
        evidence.HasKey(x => x.Id);
        // Deleting a Play must deal with its stored images explicitly, so it never cascades.
        evidence.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        evidence.HasQueryFilter(x => x.OwnerId == CurrentOwnerId);
        evidence.HasIndex(x => new { x.OwnerId, x.PlayId, x.CreatedAtUtc });
        evidence.HasIndex(x => x.ObjectKey).IsUnique();
        evidence.Property(x => x.ObjectKey).HasMaxLength(256);
        evidence.Property(x => x.ContentType).HasMaxLength(64);
        evidence.Property(x => x.Sha256).HasMaxLength(64).IsFixedLength();
        evidence.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
        evidence.Property(x => x.Note).HasMaxLength(PlayEvidence.MaxNoteLength);
    }

    private void ValidateOwnership()
    {
        // Reject foreign tracked heads even if loaded with an explicit filter bypass.
        foreach (var entry in ChangeTracker.Entries())
        {
            var ownerId = entry.Entity switch
            {
                Account account => account.OwnerId,
                Play play => play.OwnerId,
                Portfolio portfolio => portfolio.OwnerId,
                AccountSnapshot snapshot => snapshot.OwnerId,
                AccountPosition position => position.OwnerId,
                AccountStablecoin stablecoin => stablecoin.OwnerId,
                ImportedFill fill => fill.OwnerId,
                PlayEvidence evidence => evidence.OwnerId,
                _ => (Guid?)null
            };
            if (ownerId.HasValue && (ownerId != CurrentOwnerId ||
                entry.Property(nameof(Account.OwnerId)).OriginalValue is Guid original && original != CurrentOwnerId))
                throw new UnauthorizedAccessException("Cannot write another owner's records.");
        }
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ValidateOwnership();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ValidateOwnership();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }
}

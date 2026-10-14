using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Ownership;
using Vessel.Domain.Accounts;
using Vessel.Domain.Common;
using Vessel.Domain.Credentials;
using Vessel.Domain.Evidence;
using Vessel.Domain.Plays;
using Vessel.Domain.Sizing;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence;

public sealed class VesselDbContext(DbContextOptions<VesselDbContext> options, IJournalOwnerContext owner)
    : DbContext(options)
{
    public Guid CurrentOwnerId => owner.OwnerId;
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<AccountCredential> AccountCredentials => Set<AccountCredential>();
    public DbSet<Play> Plays => Set<Play>();
    public DbSet<Portfolio> Portfolios => Set<Portfolio>();
    public DbSet<AccountSnapshot> Snapshots => Set<AccountSnapshot>();
    public DbSet<AccountPosition> Positions => Set<AccountPosition>();
    public DbSet<AccountStablecoin> Stablecoins => Set<AccountStablecoin>();
    public DbSet<ImportedFill> Fills => Set<ImportedFill>();
    public DbSet<PlayEvidence> Evidence => Set<PlayEvidence>();
    public DbSet<PlayPlanRevision> PlanRevisions => Set<PlayPlanRevision>();
    public DbSet<PlayStatusChange> StatusChanges => Set<PlayStatusChange>();
    public DbSet<ImportedOrder> Orders => Set<ImportedOrder>();
    public DbSet<PlayOrderLink> OrderLinks => Set<PlayOrderLink>();
    public DbSet<ManualExecution> ManualExecutions => Set<ManualExecution>();
    public DbSet<ManualExecutionHistory> ManualExecutionHistory => Set<ManualExecutionHistory>();
    public DbSet<PlayReviewRevision> ReviewRevisions => Set<PlayReviewRevision>();
    public DbSet<DiaryRequest> DiaryRequests => Set<DiaryRequest>();
    public DbSet<SizingSettings> SizingSettings => Set<SizingSettings>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var account = modelBuilder.Entity<Account>();
        account.ToTable("accounts", table =>
        {
            table.HasCheckConstraint("CK_accounts_normalized_address", "\"Address\" IS NULL OR \"Address\" = lower(\"Address\")");
            table.HasCheckConstraint("CK_accounts_settings_revision", "\"SettingsRevision\" >= 1");
            table.HasCheckConstraint("CK_accounts_source_identity",
                """("Address" IS NULL OR "SourceId" IS NOT NULL AND "SourceId" = "Address") AND CASE WHEN "SourceId" IS NULL OR "Address" IS NOT NULL THEN true WHEN "SourceId" ~ '^(0|[1-9][0-9]{0,18})$' THEN "SourceId"::numeric <= 9223372036854775807 ELSE false END""");
        });
        account.HasKey(x => x.Id);
        account.HasAlternateKey(x => new { x.OwnerId, x.Id });
        account.Property(x => x.VenueId).HasMaxLength(64);
        account.Property(x => x.Name).HasMaxLength(200);

        var portfolio = modelBuilder.Entity<Portfolio>();
        portfolio.ToTable("portfolios");
        portfolio.HasKey(x => x.Id);
        portfolio.HasAlternateKey(x => new { x.OwnerId, x.Id });
        portfolio.Property(x => x.Name).HasMaxLength(200);
        portfolio.Property(x => x.Icon).HasMaxLength(PortfolioIcons.MaxLength).HasDefaultValue(PortfolioIcons.Default);
        account.HasOne<Portfolio>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PortfolioId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        account.HasIndex(x => new { x.OwnerId, x.VenueId, x.SourceId }).IsUnique()
            .HasDatabaseName("UX_accounts_owner_venue_source").HasFilter("\"SourceId\" IS NOT NULL");
        account.Property(x => x.SettingsRevision).HasDefaultValue(1L);
        // With a database default, EF omits a property equal to its sentinel. A true
        // sentinel keeps an explicitly disabled new account from being stored as enabled.
        account.Property(x => x.IsEnabled).HasDefaultValue(true).HasSentinel(true);
        account.Property(x => x.Address).HasMaxLength(42);
        account.Property(x => x.SourceId).HasMaxLength(128);
        account.Property(x => x.SyncStatus).HasMaxLength(32);
        account.Property(x => x.LastSyncError).HasMaxLength(200);
        account.Property(x => x.HistoryNotice).HasMaxLength(1000);

        var credential = modelBuilder.Entity<AccountCredential>();
        credential.ToTable("account_credentials", table =>
        {
            table.HasCheckConstraint("CK_account_credentials_envelope",
                """octet_length("Nonce") = 12 AND octet_length("Tag") = 16 AND octet_length("Ciphertext") BETWEEN 1 AND 2048""");
            table.HasCheckConstraint("CK_account_credentials_scope", "\"Scope\" IN ('single', 'all')");
        });
        credential.HasKey(x => new { x.OwnerId, x.AccountId, x.Purpose });
        credential.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Cascade);
        credential.Property(x => x.Purpose).HasMaxLength(128);
        credential.Property(x => x.KeyId).HasMaxLength(64);
        credential.Property(x => x.Scope).HasMaxLength(16);
        credential.Property(x => x.LastError).HasMaxLength(32);

        var snapshot = modelBuilder.Entity<AccountSnapshot>();
        snapshot.ToTable("account_snapshots");
        snapshot.HasKey(x => new { x.OwnerId, x.AccountId });
        snapshot.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
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
        var position = modelBuilder.Entity<AccountPosition>();
        position.ToTable("account_positions");
        position.HasKey(x => new { x.OwnerId, x.AccountId, x.ContractId });
        position.Property(x => x.ContractId).HasMaxLength(128);
        position.Property(x => x.VenueContractId).HasMaxLength(128);
        snapshot.HasMany(x => x.Positions).WithOne().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .OnDelete(DeleteBehavior.Cascade);

        var fill = modelBuilder.Entity<ImportedFill>();
        fill.ToTable("imported_fills");
        fill.HasKey(x => x.Id);
        fill.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        fill.HasIndex(x => new { x.OwnerId, x.AccountId, x.ContractId, x.SourceFillId }).IsUnique();
        fill.HasIndex(x => new { x.OwnerId, x.OccurredAtUtc });
        fill.Property(x => x.ContractId).HasMaxLength(128);
        fill.Property(x => x.SourceFillId).HasMaxLength(128);
        fill.Property(x => x.VenueContractId).HasMaxLength(128);
        fill.Property(x => x.Side).HasMaxLength(32);
        fill.Property(x => x.Direction).HasMaxLength(128);
        fill.Property(x => x.PositionEffect).HasMaxLength(16);
        fill.Property(x => x.FeeBasis).HasMaxLength(32);
        fill.Property(x => x.PnlBasis).HasMaxLength(16);
        fill.ToTable(table =>
        {
            table.HasCheckConstraint("CK_imported_fills_side", "\"Side\" IN ('buy', 'sell')");
            table.HasCheckConstraint("CK_imported_fills_position_effect", "\"PositionEffect\" IN ('open', 'close', 'flip', 'unknown')");
            table.HasCheckConstraint("CK_imported_fills_fee_basis", "\"FeeBasis\" IN ('reported', 'standard-account-free')");
            table.HasCheckConstraint("CK_imported_fills_pnl_basis", "\"PnlBasis\" IN ('gross', 'net-of-fee')");
        });
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
        play.Property(x => x.InstrumentSource).HasConversion<string>().HasMaxLength(16);
        play.Property(x => x.CancelReason).HasConversion<string>().HasMaxLength(16);
        play.Property(x => x.Title).HasMaxLength(Play.MaxTitleLength);
        play.Property(x => x.Plan).HasColumnType("jsonb");
        play.Property(x => x.Drawings).HasColumnType("jsonb");
        play.Property(x => x.Review).HasMaxLength(Play.MaxReviewLength);
        play.Property(x => x.Origin).HasConversion<string>().HasMaxLength(16);
        play.Property(x => x.ReviewAdherence).HasMaxLength(32);
        play.Property(x => x.ReviewMistakeTag).HasMaxLength(100);
        play.Property(x => x.ReviewLesson).HasMaxLength(4000);
        play.Property(x => x.ReviewNextAction).HasMaxLength(4000);
        play.Ignore(x => x.Answers);
        play.Ignore(x => x.HasReview);
        play.Property(x => x.Version).IsConcurrencyToken();
        play.HasIndex(x => new { x.OwnerId, x.UpdatedAtUtc });
        play.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        play.Ignore(x => x.Instrument);
        play.Property(x => x.VenueId).HasMaxLength(64);
        play.Property(x => x.ContractId).HasMaxLength(128);
        // Deliberately non-unique. Distinct active ideas can share a venue position.
        play.HasIndex(x => new { x.OwnerId, x.AccountId, x.VenueId, x.ContractId });
        play.HasAlternateKey(x => new { x.OwnerId, x.Id });

        var revision = modelBuilder.Entity<PlayPlanRevision>();
        revision.ToTable("play_plan_revisions", table => table.HasCheckConstraint("CK_play_plan_revisions_number", "\"Number\" >= 1"));
        revision.HasKey(x => x.Id);
        // History is deleted only with its Draft, explicitly; it never cascades.
        revision.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        revision.HasIndex(x => new { x.OwnerId, x.PlayId, x.Number }).IsUnique();
        revision.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
        revision.Property(x => x.Plan).HasColumnType("jsonb");
        revision.Property(x => x.Reason).HasMaxLength(PlayPlanRevision.MaxReasonLength);

        var statusChange = modelBuilder.Entity<PlayStatusChange>();
        statusChange.ToTable("play_status_changes");
        statusChange.HasKey(x => x.Id);
        statusChange.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        statusChange.HasIndex(x => new { x.OwnerId, x.PlayId, x.OccurredAtUtc });
        statusChange.Property(x => x.From).HasConversion<string>().HasMaxLength(16);
        statusChange.Property(x => x.To).HasConversion<string>().HasMaxLength(16);
        statusChange.Property(x => x.Reason).HasConversion<string>().HasMaxLength(16);
        statusChange.Property(x => x.Note).HasMaxLength(Play.MaxCancelNoteLength);
        var reviewRevision = modelBuilder.Entity<PlayReviewRevision>();
        reviewRevision.ToTable("play_review_revisions");
        reviewRevision.HasKey(x => x.Id);
        reviewRevision.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Cascade);
        reviewRevision.HasIndex(x => new { x.OwnerId, x.PlayId, x.Number }).IsUnique();
        reviewRevision.Property(x => x.StructuredReview).HasColumnType("jsonb");
        reviewRevision.Property(x => x.Review).HasMaxLength(Play.MaxReviewLength);

        var manual = modelBuilder.Entity<ManualExecution>();
        manual.ToTable("manual_executions");
        manual.HasKey(x => x.Id);
        manual.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Cascade);
        manual.HasIndex(x => new { x.OwnerId, x.PlayId, x.OccurredAtUtc });
        manual.Property(x => x.Role).HasMaxLength(16); manual.Property(x => x.EntryId).HasMaxLength(100);
        manual.Property(x => x.Side).HasMaxLength(8); manual.Property(x => x.Source).HasMaxLength(100);
        manual.Property(x => x.Quantity).HasMaxLength(96); manual.Property(x => x.Price).HasMaxLength(96);
        manual.Property(x => x.Fee).HasMaxLength(96); manual.Property(x => x.FeeCurrency).HasMaxLength(32);

        var manualHistory = modelBuilder.Entity<ManualExecutionHistory>();
        manualHistory.ToTable("manual_execution_history");
        manualHistory.HasKey(x => x.Id);
        manualHistory.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Cascade);
        manualHistory.HasIndex(x => new { x.OwnerId, x.PlayId, x.OccurredAtUtc });
        manualHistory.Property(x => x.Before).HasColumnType("jsonb");
        manualHistory.Property(x => x.After).HasColumnType("jsonb");
        manualHistory.Property(x => x.Reason).HasMaxLength(2000);

        var request = modelBuilder.Entity<DiaryRequest>();
        request.ToTable("diary_requests");
        request.HasKey(x => new { x.OwnerId, x.Id });
        request.Property(x => x.PayloadHash).HasMaxLength(64);
        request.Property(x => x.Response).HasColumnType("jsonb");
        statusChange.Property(x => x.Source).HasConversion<string>().HasMaxLength(16).HasDefaultValue(StatusChangeSource.Owner)
            .HasSentinel(StatusChangeSource.Owner);

        var order = modelBuilder.Entity<ImportedOrder>();
        order.ToTable("imported_orders");
        order.HasKey(x => x.Id);
        order.HasOne<Account>().WithMany().HasForeignKey(x => new { x.OwnerId, x.AccountId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        order.HasIndex(x => new { x.OwnerId, x.AccountId, x.OrderId }).IsUnique();
        order.Property(x => x.ContractId).HasMaxLength(128);
        order.Property(x => x.OrderId).HasMaxLength(128);
        order.Property(x => x.VenueContractId).HasMaxLength(128);
        order.Property(x => x.Side).HasMaxLength(8);
        order.ToTable(table => table.HasCheckConstraint("CK_imported_orders_side", "\"Side\" IN ('buy', 'sell')"));
        order.Property(x => x.OrderType).HasMaxLength(32);
        order.Property(x => x.Status).HasMaxLength(16);
        order.Property(x => x.VenueStatus).HasMaxLength(64);

        var link = modelBuilder.Entity<PlayOrderLink>();
        link.ToTable("play_order_links");
        link.HasKey(x => x.Id);
        link.HasOne<Play>().WithMany().HasForeignKey(x => new { x.OwnerId, x.PlayId })
            .HasPrincipalKey(x => new { x.OwnerId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        link.Ignore(x => x.LevelKey);
        link.Property(x => x.OrderId).HasMaxLength(128);
        link.Property(x => x.EntryId).HasMaxLength(64);
        link.Property(x => x.LevelId).HasMaxLength(64);
        link.Property(x => x.Role).HasConversion<string>().HasMaxLength(16);
        link.Property(x => x.State).HasConversion<string>().HasMaxLength(16);
        link.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
        link.HasIndex(x => new { x.OwnerId, x.AccountId, x.OrderId });
        link.HasIndex(x => new { x.OwnerId, x.PlayId });
        // An order counts toward at most one level of one Play.
        link.HasIndex(x => new { x.OwnerId, x.AccountId, x.OrderId }).IsUnique()
            .HasDatabaseName("UX_play_order_links_linked_order").HasFilter("\"State\" = 'Linked'");

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
        evidence.HasIndex(x => new { x.OwnerId, x.PlayId, x.CreatedAtUtc });
        evidence.HasIndex(x => x.ObjectKey).IsUnique();
        evidence.Property(x => x.ObjectKey).HasMaxLength(256);
        evidence.Property(x => x.ContentType).HasMaxLength(64);
        evidence.Property(x => x.Sha256).HasMaxLength(64).IsFixedLength();
        evidence.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
        evidence.Property(x => x.Note).HasMaxLength(PlayEvidence.MaxNoteLength);
        evidence.Property(x => x.Markup).HasColumnType("jsonb");

        var sizing = modelBuilder.Entity<SizingSettings>();
        sizing.ToTable("sizing_settings", table => table.HasCheckConstraint("CK_sizing_settings_risk",
            "\"RiskPercent\" >= 0.1 AND \"RiskPercent\" <= 5"));
        sizing.HasKey(x => x.OwnerId);
        sizing.Property(x => x.RiskPercent).HasPrecision(5, 2);
        ApplyOwnerFilters(modelBuilder);
    }

    // Every entity type is owned and filtered to the current owner. A type that is not IOwned fails model
    // building, so a new table cannot silently miss the read filter or the save guard.
    private void ApplyOwnerFilters(ModelBuilder modelBuilder)
    {
        // The context constant becomes a per-query parameter, exactly as with HasQueryFilter(x => x.OwnerId == CurrentOwnerId).
        var currentOwnerId = Expression.Property(Expression.Constant(this), nameof(CurrentOwnerId));
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            if (!typeof(IOwned).IsAssignableFrom(entityType.ClrType))
                throw new InvalidOperationException(
                    $"Entity type '{entityType.DisplayName()}' must implement {nameof(IOwned)} to be filtered and guarded by owner.");
            var entity = Expression.Parameter(entityType.ClrType, "e");
            var ownerId = Expression.Property(Expression.Convert(entity, typeof(IOwned)), nameof(IOwned.OwnerId));
            entityType.SetQueryFilter(Expression.Lambda(Expression.Equal(ownerId, currentOwnerId), entity));
        }
    }

    private void ValidateOwnership()
    {
        // Reject foreign tracked records even if loaded with an explicit filter bypass.
        foreach (var entry in ChangeTracker.Entries())
        {
            if (entry.State == EntityState.Modified &&
                entry.Entity is Vessel.Domain.Plays.ManualExecutionHistory or PlayReviewRevision or DiaryRequest)
                throw new InvalidOperationException("Diary audit and request records are append-only.");
            var owned = entry.Entity as IOwned ?? throw new InvalidOperationException(
                $"Entity type '{entry.Metadata.DisplayName()}' has no owner and cannot be saved.");
            if (owned.OwnerId != CurrentOwnerId ||
                entry.Property(nameof(IOwned.OwnerId)).OriginalValue is Guid original && original != CurrentOwnerId)
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

namespace Vessel.Domain.Accounts;

public sealed class Account
{
    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public string VenueId { get; private set; } = null!;
    public string Name { get; private set; } = null!;
    public Guid? PortfolioId { get; private set; }
    public string? Address { get; private set; }
    public decimal? ManualAccountValueUsd { get; private set; }
    public DateTimeOffset? LastSyncedAtUtc { get; private set; }
    public string SyncStatus { get; private set; } = "not-synced";
    public string? LastSyncError { get; private set; }
    public string? HistoryNotice { get; private set; }
    public bool IsEnabled { get; private set; } = true;
    public long SettingsRevision { get; private set; } = 1;
    private Account() { }

    public void Configure(Guid? portfolioId, string? address, decimal? manualAccountValueUsd)
    {
        if (portfolioId == Guid.Empty || manualAccountValueUsd < 0)
            throw new ArgumentException("Invalid account configuration.");
        PortfolioId = portfolioId; Address = address?.ToLowerInvariant(); ManualAccountValueUsd = manualAccountValueUsd;
        SyncStatus = VenueId == "manual" ? "manual" : "not-synced";
    }

    public void UpdateSettings(string name, Guid? portfolioId, bool isEnabled)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        if (name.Length > 200 || portfolioId == Guid.Empty)
            throw new ArgumentException("Invalid account settings.");
        var nextRevision = checked(SettingsRevision + 1);
        Name = name.Trim(); PortfolioId = portfolioId; IsEnabled = isEnabled;
        SettingsRevision = nextRevision;
    }

    public void RecordSync(DateTimeOffset observedAtUtc, string historyNotice)
    {
        if (LastSyncedAtUtc is null || observedAtUtc > LastSyncedAtUtc)
            LastSyncedAtUtc = observedAtUtc;
        HistoryNotice = historyNotice;
        SyncStatus = "synced"; LastSyncError = null;
    }

    public void RecordSyncFailure()
    {
        SyncStatus = "error"; LastSyncError = "The venue refresh failed. Try again later.";
    }

    public Account(Guid id, Guid ownerId, string venueId, string name)
    {
        if (id == Guid.Empty || ownerId == Guid.Empty)
            throw new ArgumentException("Account and owner IDs must be nonempty.");
        ArgumentException.ThrowIfNullOrWhiteSpace(venueId);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        if (venueId.Length > 64 || name.Length > 200)
            throw new ArgumentException("Account text exceeds storage limits.");
        Id = id;
        OwnerId = ownerId;
        VenueId = venueId;
        Name = name.Trim();
        SyncStatus = venueId == "manual" ? "manual" : "not-synced";
    }
}

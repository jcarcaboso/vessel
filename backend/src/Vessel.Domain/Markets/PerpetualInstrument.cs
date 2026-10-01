namespace Vessel.Domain.Markets;

// Venue contract ID, not a bare asset symbol. No spot markets in this foundation.
public sealed record PerpetualInstrument
{
    public string VenueId { get; private set; } = null!;
    public string ContractId { get; private set; } = null!;
    private PerpetualInstrument() { }

    public PerpetualInstrument(string venueId, string contractId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(venueId);
        ArgumentException.ThrowIfNullOrWhiteSpace(contractId);
        if (venueId.Length > 64 || contractId.Length > 128)
            throw new ArgumentException("Instrument identity exceeds storage limits.");
        VenueId = venueId;
        ContractId = contractId;
    }
}

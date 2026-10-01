using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;

namespace Vessel.Domain.Plays;

public enum PlayStatus { Active, Closed }

// A distinct idea head. It contains neither inferred executions nor an invented thesis.
public sealed class Play
{
    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public Guid AccountId { get; private set; }
    public string VenueId { get; private set; } = null!;
    public string ContractId { get; private set; } = null!;
    public PerpetualInstrument Instrument => new(VenueId, ContractId);
    public PlayStatus Status { get; private set; }
    private Play() { }

    public Play(Guid id, Account account, PerpetualInstrument instrument)
    {
        if (id == Guid.Empty) throw new ArgumentException("Play ID must be nonempty.");
        ArgumentNullException.ThrowIfNull(account);
        ArgumentNullException.ThrowIfNull(instrument);
        if (account.VenueId != instrument.VenueId)
            throw new ArgumentException("Instrument must belong to the account venue.");
        Id = id;
        OwnerId = account.OwnerId;
        AccountId = account.Id;
        VenueId = instrument.VenueId;
        ContractId = instrument.ContractId;
        Status = PlayStatus.Active;
    }

    public void Close() => Status = PlayStatus.Closed;
}

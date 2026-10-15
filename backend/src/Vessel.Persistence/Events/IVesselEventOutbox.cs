using Vessel.Application.Events;

namespace Vessel.Persistence.Events;

/// <summary>
/// The durable outbox, implemented by Vessel.Messaging. Staging writes envelopes on the unit of work's own
/// transaction; flushing happens only after commit. Neither Application nor Domain knows the transport.
/// </summary>
public interface IVesselEventOutbox
{
    /// <summary>Publish once to the event topic; the outbox knows nothing about subscribers.</summary>
    Task StageAsync(VesselEvent message, CancellationToken cancellationToken);
    Task StageAsync(MonitorAccountCommand command, CancellationToken cancellationToken);
    Task FlushAsync(CancellationToken cancellationToken);
    void Reset();
}

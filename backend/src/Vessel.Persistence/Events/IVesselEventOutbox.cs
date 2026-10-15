using Vessel.Application.Events;

namespace Vessel.Persistence.Events;

public sealed record EventEnvelopeReference(string Schema, Guid EnvelopeId);

// Infrastructure-only. Neither Application nor Domain knows the transport.
public interface IVesselEventOutbox
{
    Task<IReadOnlyList<EventEnvelopeReference>> StageAsync(VesselEvent message, CancellationToken cancellationToken);
    Task StageAsync(MonitorAccountCommand command, CancellationToken cancellationToken);
    Task FlushAsync(CancellationToken cancellationToken);
    void Reset();
}

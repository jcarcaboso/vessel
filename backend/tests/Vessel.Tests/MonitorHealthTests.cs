using Microsoft.Extensions.Logging.Abstractions;
using Vessel.Application.Monitoring;
using Vessel.Application.Ownership;
using Vessel.Worker;

namespace Vessel.Tests;

public sealed class MonitorHealthTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Failed_system_discovery_or_heartbeat_storage_cannot_make_container_health_green(bool recordFailure)
    {
        var file = Path.Combine(Path.GetTempPath(), "vessel-b2-health-" + Guid.NewGuid().ToString("N"));
        var state = new FailingState();
        using var scheduler = new MonitorScheduler(new NoScopes(), new MutableOwnerDirectory(), TimeProvider.System,
            new() { HeartbeatFile = file }, new(), NullLogger<MonitorScheduler>.Instance, new Candidates(recordFailure), state,
            new() { Deployment = "monitor", Modules = ["monitor"] });
        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => scheduler.TickAsync(default));
            Assert.Equal(recordFailure ? 1 : 0, state.Records);
            Assert.False(File.Exists(file));
        }
        finally { File.Delete(file); }
    }

    private sealed class NoScopes : IOwnerScopeFactory
    {
        public IOwnerScope Create(Guid ownerId) => throw new NotSupportedException();
    }
    private sealed class Candidates(bool productive) : ISystemMonitorStore
    {
        public Task<IReadOnlyList<DueMonitorCandidate>> DueCandidatesAsync(DueMonitorKey? after, DateTimeOffset dueBy, int limit, CancellationToken ct) =>
            productive ? Task.FromResult<IReadOnlyList<DueMonitorCandidate>>([]) : throw new InvalidOperationException("Synthetic query failure");
    }
    private sealed class FailingState : IServerStateStore
    {
        public int Records;
        public Task RecordHeartbeatAsync(string deployment, DateTimeOffset now, CancellationToken ct)
        {
            Records++; throw new InvalidOperationException("Synthetic heartbeat failure");
        }
        public Task<ServerMonitorHeartbeat?> HeartbeatAsync(CancellationToken ct) => throw new NotSupportedException();
        public Task<DateTimeOffset?> VenueRetryAtAsync(string venueId, CancellationToken ct) => throw new NotSupportedException();
        public Task<IReadOnlyDictionary<string, DateTimeOffset>> VenueRetriesAsync(CancellationToken ct) => throw new NotSupportedException();
        public Task DeferVenueAsync(string venueId, DateTimeOffset retryAtUtc, DateTimeOffset now, CancellationToken ct) => throw new NotSupportedException();
    }
}

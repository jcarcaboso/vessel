using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Vessel.Application.Events;
using Vessel.Persistence.Events;
using Wolverine;

namespace Vessel.Tests;

internal static class PlayEventTestHosting
{
    public static void ConfigureBootstrap(IHostBuilder builder) =>
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            // Program validates transport configuration before WebApplicationFactory applies app settings.
            // No network is used: ConfigureServices explicitly replaces transport for these API tests.
            ["Vessel:Events:RabbitMqUri"] = "amqp://unused:unused@127.0.0.1:1",
            ["ConnectionStrings:Vessel"] = "Host=127.0.0.1;Port=1;Database=unused;Username=unused;Password=unused"
        }));

    public static void ConfigureServices(IServiceCollection services)
    {
        services.DisableAllExternalWolverineTransports();
        services.DisableAllWolverineMessagePersistence();
        services.Replace(ServiceDescriptor.Scoped<IPlayEventOutbox, NonTransportOutbox>());
    }

    // Retains real mutation capture, event history and pending business receipts. Only network publication
    // is replaced. PlayEventTransportTests exercise the actual broker/outbox and durable acknowledgement.
    private sealed class NonTransportOutbox : IPlayEventOutbox
    {
        public Task<IReadOnlyList<EventEnvelopeReference>> StageAsync(PlayEvent message, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<EventEnvelopeReference>>([]);
        public Task StageAsync(MonitorAccountCommand command, CancellationToken ct) => Task.CompletedTask;
        public Task FlushAsync(CancellationToken ct) => Task.CompletedTask;
        public void Reset() { }
    }
}

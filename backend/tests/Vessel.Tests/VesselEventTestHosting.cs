using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Vessel.Application.Events;
using Vessel.Persistence.Events;
using Microsoft.EntityFrameworkCore;
using Vessel.Persistence;
using Wolverine;

namespace Vessel.Tests;

internal static class VesselEventTestHosting
{
    public static void ConfigureBootstrap(IHostBuilder builder) =>
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            // Program validates transport configuration before WebApplicationFactory applies app settings.
            // No network is used: ConfigureServices explicitly replaces transport for these API tests.
            ["Vessel:Messaging:RabbitMqUri"] = "amqp://unused:unused@127.0.0.1:1",
            ["ConnectionStrings:Vessel"] = "Host=127.0.0.1;Port=1;Database=unused;Username=unused;Password=unused"
        }));

    public static void ConfigureServices(IServiceCollection services)
    {
        services.DisableAllExternalWolverineTransports();
        services.DisableAllWolverineMessagePersistence();
        services.Replace(ServiceDescriptor.Scoped<IVesselEventOutbox, NonTransportOutbox>());
    }

    // Retains real mutation capture and event history. Only network publication is replaced;
    // VesselEventTransportTests exercise the actual broker, outbox and subscription settlement.
    private sealed class NonTransportOutbox : IVesselEventOutbox
    {
        public Task StageAsync(VesselEvent message, CancellationToken ct) => Task.CompletedTask;
        public Task StageAsync(MonitorAccountCommand command, CancellationToken ct) => Task.CompletedTask;
        public Task FlushAsync(CancellationToken ct) => Task.CompletedTask;
        public void Reset() { }
    }
}

/// <summary>Reads committed history the way the browser does, resuming in the database's current epoch.</summary>
internal static class EventReads
{
    public static async Task<VesselEventPage> ReadAsync(VesselDbContext db, long after, int limit, CancellationToken ct)
    {
        Guid? epoch = null;
        if (after != 0)
        {
            await using var connection = new Npgsql.NpgsqlConnection(db.Database.GetConnectionString());
            await connection.OpenAsync(ct);
            await using var command = new Npgsql.NpgsqlCommand("SELECT epoch FROM event_cursors WHERE owner_id=@owner", connection);
            command.Parameters.AddWithValue("owner", db.CurrentOwnerId);
            epoch = await command.ExecuteScalarAsync(ct) as Guid?;
        }
        return await new VesselEventHistory(db).ReadAsync(VesselEventCursor.Format(epoch, after), limit, ct);
    }

    public static long Sequence(this VesselEventPage page) =>
        VesselEventCursor.TryParse(page.NextCursor, out var cursor) ? cursor.Sequence : -1;
}

using System.Data.Common;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Vessel.Persistence;
using Vessel.Persistence.Events;

namespace Vessel.Tests;

public sealed class VesselEventRabbitFactAttribute : FactAttribute
{
    public VesselEventRabbitFactAttribute()
    {
        if (new VesselEventPostgresFactAttribute().Skip is { } reason) { Skip = reason; return; }
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("Vessel_TEST_EVENT_RABBIT")))
            Skip = "Requires an explicit disposable Vessel_TEST_EVENT_RABBIT broker.";
    }
}

[Collection("Monitor transport")]
public sealed class VesselEventTransportTests
{
    [VesselEventRabbitFact]
    public async Task Actual_EF_transaction_contains_event_and_outbox_before_outer_commit_then_delivers_once_by_business_id()
    {
        await using var database = await CoreDatabase.CreateAsync("20261014180000_VesselEvents");
        var owner = Guid.NewGuid();
        var apiSchema = "events_api_" + Guid.NewGuid().ToString("N");
        var workerSchema = "events_worker_" + Guid.NewGuid().ToString("N");
        var config = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Vessel"] = database.ConnectionString,
            ["Vessel:Auth:OwnerId"] = owner.ToString(),
            ["Vessel:Events:RabbitMqUri"] = Environment.GetEnvironmentVariable("Vessel_TEST_EVENT_RABBIT"),
            ["Vessel:Events:ApiStorageSchema"] = apiSchema,
            ["Vessel:Events:WorkerStorageSchema"] = workerSchema
        };
        using var api = Host(config, "api", owner);
        using var worker = Host(config, "worker", owner);
        try
        {
            await api.ProvisionVesselEventTransportAsync();
            await worker.ProvisionVesselEventTransportAsync();
            await api.StartAsync();
            await using var scope = api.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<VesselDbContext>();
            var sink = scope.ServiceProvider.GetRequiredService<VesselEventStore>();
            var draft = new VesselEventDraft("monitor.state-changed", Guid.CreateVersion7(), "transport-test", "info",
                DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, new(), new("owner"),
                JsonSerializer.SerializeToElement(new { previous = "idle", current = "live" }));
            var rollback = true;
            var duplicate = false;
            var verifyCommit = new CommitProbe { After = async () =>
            {
                // Runs before the event participant's flush, but after the real UoW commit.
                Assert.Equal(1, await Count(database.ConnectionString, "SELECT count(*) FROM events"));
                Assert.Equal(1, await Count(database.ConnectionString, $"SELECT count(*) FROM {apiSchema}.wolverine_outgoing_envelopes"));
            }};
            var verifyStage = new CommitProbe { Before = async () =>
            {
                Assert.Equal(1, await CountInTransaction(db, apiSchema));
                Assert.Equal(0, await Count(database.ConnectionString, $"SELECT count(*) FROM {apiSchema}.wolverine_outgoing_envelopes"));
                Assert.Equal(duplicate ? 1 : 0, await Count(database.ConnectionString, "SELECT count(*) FROM events"));
                if (rollback) throw new InvalidOperationException("Synthetic rollback after durable staging.");
            }};
            var work = new UnitOfWork(db, [verifyCommit, sink, verifyStage]);
            await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(async () =>
            {
                await sink.AppendAsync(draft, default);
                return true;
            }, default));
            Assert.Equal(0, await Count(database.ConnectionString, $"SELECT count(*) FROM {apiSchema}.wolverine_outgoing_envelopes"));
            rollback = false;
            await work.ExecuteAsync(async () =>
            {
                await sink.AppendAsync(draft, default);
                return true;
            }, default);
            // AfterCommit errors cannot fail the operation; assert this probe's actual result outside it.
            Assert.Null(verifyCommit.Error);
            Assert.Equal(1, verifyCommit.Commits);
            var original = Assert.Single((await sink.ReadAsync(0, 200, default)).Events);
            await worker.StartAsync();
            await Eventually(async () => await Count(database.ConnectionString,
                "SELECT count(*) FROM event_deliveries WHERE consumer='monitor' AND state='delivered'") == 1);
            Assert.Equal(1, await Count(database.ConnectionString,
                "SELECT attempts FROM event_deliveries WHERE consumer='monitor'"));
            // Republish with a new transport envelope and the SAME business EventId.
            var outbox = scope.ServiceProvider.GetRequiredService<IVesselEventOutbox>();
            duplicate = true;
            await work.ExecuteAsync(async () =>
            {
                await outbox.StageAsync(original, default);
                return true;
            }, default);
            Assert.Null(verifyCommit.Error);
            Assert.Equal(2, verifyCommit.Commits);
            await Eventually(async () => await Count(database.ConnectionString,
                $"SELECT count(*) FROM {apiSchema}.wolverine_outgoing_envelopes") == 0);
            await Task.Delay(300);
            Assert.Equal(1, await Count(database.ConnectionString,
                "SELECT attempts FROM event_deliveries WHERE consumer='monitor'"));
            Assert.Equal(original.Id, Assert.Single((await sink.ReadAsync(0, 200, default)).Events).Id);
        }
        finally
        {
            await worker.StopAsync();
            await api.StopAsync();
            await using var connection = new NpgsqlConnection(database.ConnectionString);
            await connection.OpenAsync();
            await using var drop = new NpgsqlCommand($"DROP SCHEMA IF EXISTS {apiSchema} CASCADE; DROP SCHEMA IF EXISTS {workerSchema} CASCADE", connection);
            await drop.ExecuteNonQueryAsync();
        }
    }

    private static IHost Host(Dictionary<string, string?> config, string role, Guid owner)
    {
        var builder = Microsoft.Extensions.Hosting.Host.CreateApplicationBuilder([]);
        builder.Configuration.Sources.Clear();
        builder.Configuration.AddInMemoryCollection(config);
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton<IJournalOwnerContext>(new CoreOwner(owner));
        builder.Services.AddVesselPersistence(builder.Configuration);
        builder.ConfigureVesselEventTransport(builder.Configuration, role,
            options => { if (role == "worker") options.Discovery.IncludeType<TestMonitorCommandHandler>(); });
        return builder.Build();
    }

    private static async Task<long> Count(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }
    private static async Task<long> CountInTransaction(VesselDbContext db, string schema)
    {
        await using DbCommand command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = $"SELECT count(*) FROM {schema}.wolverine_outgoing_envelopes";
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }
    private static async Task Eventually(Func<Task<bool>> condition)
    {
        for (var attempt = 0; attempt < 80; attempt++)
        {
            if (await condition()) return;
            await Task.Delay(250);
        }
        Assert.Fail("Disposable event delivery did not reach its durable receipt.");
    }

    private sealed class CommitProbe : IUnitOfWorkParticipant
    {
        public Func<Task> Before { get; init; } = () => Task.CompletedTask;
        public Func<Task> After { get; init; } = () => Task.CompletedTask;
        public Exception? Error { get; private set; }
        public int Commits { get; private set; }
        public Task BeforeCommitAsync(CancellationToken ct) => Before();
        public async Task AfterCommitAsync(CancellationToken ct)
        {
            Commits++;
            Error = await Record.ExceptionAsync(After);
        }
        public Task RollbackAsync(CancellationToken ct) => Task.CompletedTask;
    }
}

public sealed class TestMonitorCommandHandler
{
    public static void Handle(MonitorAccountCommand command) { }
}

using JasperFx;
using JasperFx.CodeGeneration;
using JasperFx.Resources;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using RabbitMQ.Client;
using Vessel.Application.Ownership;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Persistence;
using Weasel.Core;
using Wolverine;
using Wolverine.Attributes;
using Wolverine.EntityFrameworkCore;
using Wolverine.Postgresql;
using Wolverine.RabbitMQ;
using Wolverine.Runtime;

namespace VesselW0;

// Throwaway integration investigation, not a proposed product implementation.
public static class Program
{
    public static readonly Guid OwnerA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    public static readonly Guid OwnerB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    public static readonly Guid AccountA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    public static readonly Guid AccountB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000001");
    public static string Cs => Environment.GetEnvironmentVariable("W0_CS") ??
        "Host=127.0.0.1;Port=55489;Database=w0;Username=w0;Password=w0-disposable-only";
    public static string Amqp => Environment.GetEnvironmentVariable("W0_AMQP") ??
        "amqp://w0:w0-disposable-only@127.0.0.1:56789";
    public const string Queue = "vessel.w0.effects";
    public const string Exchange = "vessel.w0.events";

    public static async Task<int> Main(string[] args)
    {
        var mode = args.FirstOrDefault() ?? "tx";
        if (mode == "setup")
        {
            await using var db = NewDb(OwnerA);
            await db.Database.MigrateAsync(); // Only the explicitly supplied disposable DB.
            await Sql("""
                CREATE TABLE IF NOT EXISTS w0_events(id uuid PRIMARY KEY, owner_id uuid NOT NULL, play_id uuid NOT NULL);
                CREATE TABLE IF NOT EXISTS w0_deliveries(event_id uuid NOT NULL, consumer text NOT NULL, owner_id uuid NOT NULL,
                    PRIMARY KEY(event_id,consumer));
                CREATE TABLE IF NOT EXISTS w0_effects(owner_id uuid PRIMARY KEY, count integer NOT NULL);
                CREATE TABLE IF NOT EXISTS w0_rejections(id uuid PRIMARY KEY, reason text NOT NULL);
                """);
            foreach (var (owner, account) in new[] { (OwnerA, AccountA), (OwnerB, AccountB) })
            {
                await using var seed = NewDb(owner);
                if (!await seed.Accounts.AnyAsync())
                {
                    seed.Accounts.Add(new Account(account, owner, "manual", "W0 synthetic"));
                    await seed.SaveChangesAsync();
                }
            }
            foreach (var role in new[] { "api", "worker" })
            {
                using var host = Build(role);
                await host.SetupResources();
            }
            Console.WriteLine("PASS explicit setup of Vessel migrations and both Wolverine schemas");
            return 0;
        }
        using var app = Build(mode == "worker" ? "worker" : mode == "missing" ? "missing" : "api");
        if (mode == "codegen") return await app.RunJasperFxCommands(args.Skip(1).ToArray());
        try { await app.StartAsync(); }
        catch (Exception e)
        {
            Console.WriteLine($"START_FAILED {e.GetType().Name}: {e.Message}");
            return mode == "missing" ? 0 : 1;
        }
        if (mode == "missing") throw new Exception("Missing storage unexpectedly started");
        if (mode == "worker")
        {
            Console.WriteLine("WORKER_READY");
            await app.WaitForShutdownAsync();
            return 0;
        }
        if (mode == "recover")
        {
            Console.WriteLine("API_RECOVERY_READY");
            await app.WaitForShutdownAsync();
            return 0;
        }
        if (mode == "map-model")
        {
            using var scope = app.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<ScopedOwner>().Set(OwnerA);
            var model = scope.ServiceProvider.GetRequiredService<VesselDbContext>()
                .GetService<IDesignTimeModel>().Model;
            foreach (var entity in model.GetEntityTypes().Where(x =>
                x.GetTableName()?.Contains("wolverine_") == true))
                Console.WriteLine($"MAP table={entity.GetSchema()}.{entity.GetTableName()} " +
                    $"excluded_from_ef_migrations={entity.IsTableExcludedFromMigrations()}");
        }
        if (mode == "outage")
        {
            Console.WriteLine("OUTAGE_READY stop disposable broker, then press Enter");
            Console.ReadLine();
        }
        if (mode is "tx" or "bad-helper" or "early-flush" or "crash" or "outage")
        {
            await Transaction(app, mode);
        }
        else if (mode is "duplicates" or "owners" or "owner-stress" or "runtime")
        {
            var bus = app.Services.GetRequiredService<IMessageBus>();
            var id = Guid.NewGuid();
            await bus.PublishAsync(new Notice(id, OwnerA, AccountA));
            if (mode == "duplicates")
                await bus.PublishAsync(new Notice(id, OwnerA, AccountA)); // New envelope, same business EventId.
            if (mode == "owners")
            {
                await bus.PublishAsync(new Notice(Guid.NewGuid(), OwnerB, AccountB));
                await bus.PublishAsync(new Notice(Guid.NewGuid(), OwnerA, AccountB));
                await bus.PublishAsync(new Notice(Guid.NewGuid(), Guid.Empty, AccountA));
                await bus.PublishAsync(new Notice(Guid.NewGuid(), Guid.NewGuid(), AccountA));
            }
            if (mode == "owner-stress")
                for (var i = 0; i < 40; i++)
                    await bus.PublishAsync(new Notice(Guid.NewGuid(), i % 2 == 0 ? OwnerA : OwnerB,
                        i % 2 == 0 ? AccountA : AccountB));
            await Task.Delay(2500);
            Console.WriteLine($"PUBLISHED mode={mode} EventId={id}");
        }
        else if (mode == "envelope-replay")
        {
            await using var connection = await new ConnectionFactory { Uri = new Uri(Amqp) }.CreateConnectionAsync();
            await using var channel = await connection.CreateChannelAsync(
                new CreateChannelOptions(true, true));
            var received = await channel.BasicGetAsync(Queue, true)
                ?? throw new Exception("Replay test requires a queued message and stopped worker");
            var properties = new BasicProperties
            {
                MessageId = received.BasicProperties.MessageId,
                Headers = received.BasicProperties.Headers,
                ContentType = received.BasicProperties.ContentType,
                Type = received.BasicProperties.Type,
                CorrelationId = received.BasicProperties.CorrelationId,
                Persistent = true
            };
            for (var i = 0; i < 2; i++)
                await channel.BasicPublishAsync("", Queue, true, properties, received.Body);
            Console.WriteLine($"REPLAYED EnvelopeId={properties.MessageId} copies=2");
        }
        else if (mode == "unrouted")
        {
            var id = Guid.NewGuid();
            await app.Services.GetRequiredService<IMessageBus>()
                .BroadcastToTopicAsync("no.binding", new Notice(id, OwnerA, AccountA));
            await Task.Delay(2500);
            Console.WriteLine($"UNROUTED EventId={id} outgoing_total=" +
                await Scalar("SELECT count(*) FROM w0_api.wolverine_outgoing_envelopes"));
        }
        await app.StopAsync();
        return 0;
    }

    static IHost Build(string role)
    {
        var b = Host.CreateApplicationBuilder();
        b.Logging.SetMinimumLevel(LogLevel.Warning);
        b.Services.AddScoped<ScopedOwner>();
        b.Services.AddScoped<IJournalOwnerContext>(s => s.GetRequiredService<ScopedOwner>());
        if (Environment.GetEnvironmentVariable("W0_MAP") == "1")
            b.Services.AddDbContextWithWolverineIntegration<VesselDbContext>(o => o.UseNpgsql(Cs), $"w0_{role}");
        else
            b.Services.AddDbContext<VesselDbContext>(o => o.UseNpgsql(Cs));
        b.Services.AddScoped<WorkspaceStore>();
        b.Services.AddScoped<ExecutionStore>();
        b.UseWolverine(o =>
        {
            o.ServiceName = $"vessel-w0-sol-{role}";
            o.AutoBuildMessageStorageOnStartup = AutoCreate.None;
            // Spike only: shorten dead-node recovery so crash tests finish in seconds.
            o.Durability.StaleNodeTimeout = TimeSpan.FromSeconds(5);
            o.Durability.StaleNodeEjectionThreshold = 1;
            o.Durability.HealthCheckPollingTime = TimeSpan.FromSeconds(1);
            o.Durability.NodeReassignmentPollingTime = TimeSpan.FromSeconds(1);
            o.Durability.OrphanedMessageSweepPollingTime = TimeSpan.FromSeconds(1);
            o.PersistMessagesWithPostgresql(Cs, $"w0_{role}");
            o.UseEntityFrameworkCoreTransactions();
            o.UseRuntimeCompilation();
            o.CodeGeneration.TypeLoadMode = TypeLoadMode.Dynamic;
            o.Discovery.DisableConventionalDiscovery();
            if (role == "worker") o.Discovery.IncludeType<NoticeHandler>();
            o.UseRabbitMq(new Uri(Amqp)).AutoProvision().UseQuorumQueues()
                .ConfigureChannelCreation(c =>
                {
                    c.PublisherConfirmationsEnabled = true;
                    c.PublisherConfirmationTrackingEnabled = true;
                });
            o.PublishMessage<Notice>().ToRabbitTopics(Exchange, e => e.BindTopic("play.#").ToQueue(Queue))
                .UseDurableOutbox();
            if (role == "worker")
                o.ListenToRabbitQueue(Queue).UseDurableInbox().MaximumParallelMessages(4);
        });
        return b.Build();
    }

    static async Task Transaction(IHost host, string mode)
    {
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<ScopedOwner>().Set(OwnerA);
        var db = scope.ServiceProvider.GetRequiredService<VesselDbContext>();
        var workspace = scope.ServiceProvider.GetRequiredService<WorkspaceStore>();
        var executions = scope.ServiceProvider.GetRequiredService<ExecutionStore>();
        var outbox = scope.ServiceProvider.GetRequiredService<IDbContextOutbox<VesselDbContext>>();
        Require(db.GetType().IsSealed, "real VesselDbContext is sealed");
        var account = await db.Accounts.SingleAsync(x => x.Id == AccountA);
        var play = new Play(Guid.NewGuid(), account, new PerpetualInstrument("manual", "BTC"),
            InstrumentSource.Manual, "{}", DateTimeOffset.UtcNow);
        db.Plays.Add(play);
        var planned = play.MarkPlanned(DateTimeOffset.UtcNow);
        db.StatusChanges.Add(planned.Change);
        db.PlanRevisions.Add(planned.Revision);
        await db.SaveChangesAsync();
        var id = Guid.NewGuid();
        var rollback = mode == "tx" || mode == "early-flush" || mode == "bad-helper";
        try
        {
            await workspace.WithAccountLockAsync(AccountA, async a =>
                await executions.WithAccountLockAsync(AccountA, async () =>
                {
                    // Same row lock -> advisory lock -> multiple SaveChanges as CheckAsync.
                    await executions.UpsertOrdersAsync(a, [], DateTimeOffset.UtcNow, default);
                    executions.Add(play.MarkOpen("W0 synthetic linked-fill transition", DateTimeOffset.UtcNow));
                    await executions.SaveAsync(default);
                    await db.Database.ExecuteSqlInterpolatedAsync(
                        $"INSERT INTO w0_events(id,owner_id,play_id) VALUES({id},{OwnerA},{play.Id})");
                    await outbox.PublishAsync(new Notice(id, OwnerA, AccountA));
                    await executions.SaveAsync(default);
                    Require(await Scalar("SELECT count(*) FROM w0_events WHERE id=@id", id) == 0,
                        "business event not visible before OUTER commit");
                    if (mode == "bad-helper") await outbox.SaveChangesAndFlushMessagesAsync();
                    if (mode == "early-flush") await outbox.FlushOutgoingMessagesAsync();
                    await Task.Delay(2000);
                    Console.WriteLine($"INNER mode={mode} outer_tx_present={db.Database.CurrentTransaction != null} " +
                        $"event_visible={await Scalar("SELECT count(*) FROM w0_events WHERE id=@id", id)} " +
                        $"consumer_effect={await Scalar("SELECT count(*) FROM w0_deliveries WHERE event_id=@id", id)}");
                    if (rollback) throw new InvalidOperationException("W0 deliberate rollback after inner saves");
                    return 0;
                }, default), default);
        }
        catch (InvalidOperationException e) when (rollback)
        {
            Console.WriteLine($"ROLLBACK_REQUESTED {e.Message}");
        }
        if (mode == "crash")
        {
            Console.WriteLine($"COMMITTED_NO_FLUSH EventId={id} PlayId={play.Id}");
            Console.Out.Flush();
            Environment.Exit(73); // Abrupt exit: no Stop/Dispose and no post-commit flush.
        }
        await using var verify = NewDb(OwnerA);
        var actual = await verify.Plays.Where(x => x.Id == play.Id).Select(x => x.Status).SingleAsync();
        var events = await Scalar("SELECT count(*) FROM w0_events WHERE id=@id", id);
        var envelopes = await Scalar("SELECT count(*) FROM w0_api.wolverine_outgoing_envelopes");
        Console.WriteLine($"FINAL mode={mode} status={actual} events={events} outgoing_total={envelopes} EventId={id}");
        if (mode == "outage")
        {
            await outbox.FlushOutgoingMessagesAsync();
            await Task.Delay(2000);
            Console.WriteLine("OUTAGE_FLUSH_QUEUED");
        }
        if (mode == "tx")
        {
            Require(actual == PlayStatus.Planned && events == 0 && envelopes == 0, "outer rollback is atomic");
            // Now prove the positive path with a separate scope/context.
            using var committedScope = host.Services.CreateScope();
            committedScope.ServiceProvider.GetRequiredService<ScopedOwner>().Set(OwnerA);
            var ctx = committedScope.ServiceProvider.GetRequiredService<VesselDbContext>();
            var sink = committedScope.ServiceProvider.GetRequiredService<IDbContextOutbox<VesselDbContext>>();
            var committedId = Guid.NewGuid();
            await committedScope.ServiceProvider.GetRequiredService<WorkspaceStore>().WithAccountLockAsync(AccountA,
                async a => await committedScope.ServiceProvider.GetRequiredService<ExecutionStore>().WithAccountLockAsync(
                    AccountA, async () =>
                    {
                        var p = await ctx.Plays.SingleAsync(x => x.Id == play.Id);
                        ctx.StatusChanges.Add(p.MarkOpen("W0 commit", DateTimeOffset.UtcNow));
                        await ctx.SaveChangesAsync();
                        ctx.StatusChanges.Add(p.MarkClosed("W0 synthetic close", DateTimeOffset.UtcNow));
                        await ctx.SaveChangesAsync();
                        await ctx.Database.ExecuteSqlInterpolatedAsync(
                            $"INSERT INTO w0_events(id,owner_id,play_id) VALUES({committedId},{OwnerA},{p.Id})");
                        await sink.PublishAsync(new Notice(committedId, OwnerA, AccountA));
                        await ctx.SaveChangesAsync();
                        Require(await Scalar("SELECT count(*) FROM w0_events WHERE id=@id", committedId) == 0,
                            "second inner saves still do not commit");
                        return 0;
                    }, default), default);
            Require(await Scalar("SELECT count(*) FROM w0_events WHERE id=@id", committedId) == 1,
                "event visible after outer commit");
            Require(await Scalar("SELECT count(*) FROM w0_api.wolverine_outgoing_envelopes") == 1,
                "outbox durable beside committed event before explicit flush");
            await using var committedCheck = NewDb(OwnerA);
            Require(await committedCheck.Plays.Where(x => x.Id == play.Id)
                .Select(x => x.Status).SingleAsync() == PlayStatus.Closed, "open/closed changes committed by outer store");
            await sink.FlushOutgoingMessagesAsync(); // Only AFTER outer store returned successfully.
            await Task.Delay(2000);
            Console.WriteLine($"PASS post-outer-commit flush EventId={committedId}");
        }
    }

    public static VesselDbContext NewDb(Guid owner) =>
        new(new DbContextOptionsBuilder<VesselDbContext>().UseNpgsql(Cs).Options, new FixedOwner(owner));
    public static async Task Sql(string sql)
    {
        await using var c = new NpgsqlConnection(Cs);
        await c.OpenAsync();
        await new NpgsqlCommand(sql, c).ExecuteNonQueryAsync();
    }
    public static async Task<long> Scalar(string sql, Guid? id = null)
    {
        await using var c = new NpgsqlConnection(Cs);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        if (id.HasValue) cmd.Parameters.AddWithValue("id", id.Value);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }
    static void Require(bool condition, string message)
    {
        if (!condition) throw new Exception($"FAIL {message}");
        Console.WriteLine($"PASS {message}");
    }
}

public sealed record FixedOwner(Guid OwnerId) : IJournalOwnerContext;
public sealed class ScopedOwner : IJournalOwnerContext
{
    Guid id;
    public Guid OwnerId => id != Guid.Empty ? id : throw new UnauthorizedAccessException("Missing W0 owner");
    public void Set(Guid value)
    {
        if (id != Guid.Empty || value != Program.OwnerA && value != Program.OwnerB)
            throw new UnauthorizedAccessException("Rejected W0 owner");
        id = value;
    }
}

[Topic("play.opened")]
public sealed record Notice(Guid EventId, Guid OwnerId, Guid AccountId);

public sealed class NoticeHandler
{
    public static async Task Handle(Notice message, IServiceScopeFactory scopes)
    {
        // New scope per message. Validate/set BEFORE resolving any DbContext.
        using var scope = scopes.CreateScope();
        if (message.OwnerId != Program.OwnerA && message.OwnerId != Program.OwnerB)
        {
            await Reject(message, "missing-or-unconfigured-owner");
            return;
        }
        scope.ServiceProvider.GetRequiredService<ScopedOwner>().Set(message.OwnerId);
        var db = scope.ServiceProvider.GetRequiredService<VesselDbContext>();
        Console.WriteLine($"HANDLE_BEGIN EventId={message.EventId} owner={db.CurrentOwnerId}");
        await Task.Delay(150); // Allow different owners to overlap in this concurrency test.
        if (!await db.Accounts.AnyAsync(x => x.Id == message.AccountId))
        {
            await Reject(message, "foreign-account");
            return;
        }
        if (db.CurrentOwnerId != message.OwnerId) throw new Exception("Owner bleed");
        await using var tx = await db.Database.BeginTransactionAsync();
        // Unique BUSINESS EventId/consumer claim and synthetic side effect, one transaction.
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            WITH claim AS (
                INSERT INTO w0_deliveries(event_id,consumer,owner_id)
                VALUES({message.EventId},'effects',{message.OwnerId})
                ON CONFLICT DO NOTHING RETURNING owner_id
            )
            INSERT INTO w0_effects(owner_id,count) SELECT owner_id,1 FROM claim
            ON CONFLICT(owner_id) DO UPDATE SET count=w0_effects.count+1
            """);
        await tx.CommitAsync();
        Console.WriteLine($"HANDLED EventId={message.EventId} owner={db.CurrentOwnerId}");
    }
    static async Task Reject(Notice m, string reason)
    {
        await using var c = new NpgsqlConnection(Program.Cs);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO w0_rejections(id,reason) VALUES(@id,@reason) ON CONFLICT DO NOTHING", c);
        cmd.Parameters.AddWithValue("id", m.EventId);
        cmd.Parameters.AddWithValue("reason", reason);
        await cmd.ExecuteNonQueryAsync();
        Console.WriteLine($"REJECTED EventId={m.EventId} reason={reason}");
    }
}

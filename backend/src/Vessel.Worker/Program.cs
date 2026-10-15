using Vessel.Application.Credentials;
using Vessel.Application.Events;
using Vessel.Application.Workspace;
using Vessel.Application.Plays.Execution;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Vessel.Application.Ownership;
using Vessel.Infrastructure;
using Vessel.Messaging;
using Vessel.Messaging.Modules.Monitor;
using Vessel.Persistence;

namespace Vessel.Worker;

internal static class WorkerProgram
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            var builder = Host.CreateApplicationBuilder(args);
            WorkerHost.Configure(builder);
            await builder.Build().RunAsync();
            return 0;
        }
        catch
        {
            // Startup failures can contain database/broker connection strings. Do not print them.
            Console.Error.WriteLine("Vessel worker could not start. Check private configuration, explicit migrations and message resource provisioning.");
            return 1;
        }
    }
}

public static class WorkerHost
{
    public static void Configure(HostApplicationBuilder builder)
    {
        var owner = JournalOwner.Parse(builder.Configuration[JournalOwner.ConfigurationKey]);
        builder.Services.AddVesselInfrastructure(builder.Configuration);
        builder.Services.RemoveAll<IJournalOwnerContext>();
        builder.Services.AddSingleton<IJournalOwnerContext>(new WorkerOwnerContext(owner));
        builder.Services.AddVesselPersistence(builder.Configuration);
        // This host owns its use-case registrations; it never references the API assembly.
        builder.Services.AddScoped<WorkspaceService>();
        builder.Services.AddScoped<PlayExecutionService>();
        builder.Services.AddScoped<IAccountCredentialReader, AccountCredentialReader>();
        builder.Services.AddVesselMonitoring(builder.Configuration);
        builder.Services.AddScoped<IVesselCommandHandler<MonitorAccountCommand>, MonitorAccountCommandHandler>();
        builder.Services.AddHostedService<MonitorScheduler>();
        builder.AddVesselMessaging(MonitorModule.ModuleName, [MonitorModule.ModuleName]);
        builder.Services.AddSubscriptionMaintenance();
    }
}

public sealed class WorkerOwnerContext(Guid ownerId) : IJournalOwnerContext
{
    public Guid OwnerId { get; } = ownerId != Guid.Empty ? ownerId : throw new ArgumentException("Owner ID must be nonempty.");
}

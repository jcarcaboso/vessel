using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Vessel.Application.Ownership;
using Vessel.Identity;
using Vessel.Infrastructure;
using Vessel.Worker;

namespace Vessel.Tests;

public sealed class OwnerDirectoryIntegrationTests
{
    [Theory]
    [InlineData("Token")]
    [InlineData("Wallet")]
    public async Task Api_composition_resolves_the_mode_directory_and_explicit_owner_scope(string mode)
    {
        var owner = Guid.NewGuid();
        await using var factory = new CoreApiFactory(owner, settings: Settings(mode, owner));
        AssertDirectory(factory.Services, mode);
        await AssertOwnerScopeAsync(factory.Services, owner);
    }

    [Theory]
    [InlineData("Token")]
    [InlineData("Wallet")]
    public async Task Worker_composition_resolves_the_mode_directory_and_explicit_owner_scope(string mode)
    {
        var owner = Guid.NewGuid();
        var builder = Builder(mode, owner);
        WorkerHost.Configure(builder);
        // Resolve the real composition without starting database/broker background services.
        using var host = builder.Build();
        AssertDirectory(host.Services, mode);
        await AssertOwnerScopeAsync(host.Services, owner);
    }

    [Theory]
    [InlineData("Token", false)]
    [InlineData("Token", true)]
    [InlineData("Wallet", false)]
    [InlineData("Wallet", true)]
    public void Directory_selection_is_independent_of_identity_infrastructure_registration_order(string mode, bool identityFirst)
    {
        var builder = Builder(mode, Guid.NewGuid());
        if (identityFirst)
        {
            builder.Services.AddVesselIdentityDirectory(builder.Configuration);
            builder.Services.AddVesselInfrastructure(builder.Configuration);
        }
        else
        {
            builder.Services.AddVesselInfrastructure(builder.Configuration);
            builder.Services.AddVesselIdentityDirectory(builder.Configuration);
        }
        using var host = builder.Build();
        AssertDirectory(host.Services, mode);
    }

    private static void AssertDirectory(IServiceProvider services, string mode)
    {
        var directory = services.GetRequiredService<IJournalOwnerDirectory>();
        Assert.Same(directory, services.GetRequiredService<IJournalOwnerDirectory>());
        Assert.Same(directory, Assert.Single(services.GetServices<IJournalOwnerDirectory>()));
        if (mode == "Token") Assert.IsType<ConfiguredOwnerDirectory>(directory);
        else Assert.IsType<IdentityOwnerDirectory>(directory);
    }

    private static async Task AssertOwnerScopeAsync(IServiceProvider services, Guid owner)
    {
        using (var unassigned = services.CreateScope())
            Assert.Throws<UnauthorizedAccessException>(() =>
                unassigned.ServiceProvider.GetRequiredService<IJournalOwnerContext>().OwnerId);
        await using var assigned = services.GetRequiredService<IOwnerScopeFactory>().Create(owner);
        Assert.Equal(owner, assigned.Services.GetRequiredService<IJournalOwnerContext>().OwnerId);
        await using var other = services.GetRequiredService<IOwnerScopeFactory>().Create(Guid.NewGuid());
        Assert.Equal(other.OwnerId, other.Services.GetRequiredService<IJournalOwnerContext>().OwnerId);
        Assert.Equal(owner, assigned.Services.GetRequiredService<IJournalOwnerContext>().OwnerId);
    }

    private static HostApplicationBuilder Builder(string mode, Guid owner)
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { DisableDefaults = true });
        builder.Configuration.AddInMemoryCollection(Settings(mode, owner));
        return builder;
    }

    private static Dictionary<string, string?> Settings(string mode, Guid owner) => new()
    {
        ["Vessel:Auth:Mode"] = mode,
        ["Vessel:Auth:Token"] = mode == "Token" ? CoreApiFactory.Token : null,
        ["Vessel:Auth:OwnerId"] = owner.ToString(),
        ["Vessel:Identity:Origins:0"] = "https://vessel.test",
        ["Vessel:Messaging:RabbitMqUri"] = "amqp://unused:unused@127.0.0.1:1",
        ["ConnectionStrings:Vessel"] = "Host=127.0.0.1;Port=1;Database=unused;Username=unused;Password=unused"
    };
}

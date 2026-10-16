using Npgsql;

namespace Vessel.Messaging;

/// <summary>
/// Which logical deployment and module set owns each envelope schema. Provisioning records it (insert-only); every
/// host checks it at startup, so a deployment never recovers envelopes in a schema provisioned for other modules.
/// Changing a deployment's module set needs an explicit drain of its schema and a new registration.
/// </summary>
public static class MessagingDeployments
{
    /// <summary>Records or confirms a deployment's schema registration. A different module set is rejected.</summary>
    public static async Task RegisterAsync(string connectionString, string schema, string deployment, string[] modules,
        CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using (var insert = new NpgsqlCommand("""
            INSERT INTO messaging_deployments(schema_name, deployment, modules, provisioned_at)
            VALUES (@schema, @deployment, @modules, now()) ON CONFLICT (schema_name) DO NOTHING
            """, connection))
        {
            insert.Parameters.AddWithValue("schema", schema);
            insert.Parameters.AddWithValue("deployment", deployment);
            insert.Parameters.AddWithValue("modules", modules);
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }
        if (await ReadAsync(connection, schema, cancellationToken) is not { } existing || !Matches(existing, deployment, modules))
            throw new InvalidOperationException($"Envelope schema {schema} is registered for another deployment or module set. " +
                "Drain it and deregister it, or configure a new schema, before changing the modules a deployment runs.");
    }

    /// <summary>Startup check: the schema must be provisioned for exactly this deployment and module set.</summary>
    public static async Task ValidateAsync(string connectionString, string schema, string deployment, string[] modules,
        CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        var existing = await ReadAsync(connection, schema, cancellationToken)
            ?? throw new InvalidOperationException($"Envelope schema {schema} is not provisioned. Run the explicit provision step first.");
        if (!Matches(existing, deployment, modules))
            throw new InvalidOperationException($"Envelope schema {schema} was provisioned for another deployment or module set. " +
                "Provision this deployment with its own schema, or drain the schema before changing its modules.");
    }

    private static bool Matches((string Deployment, string[] Modules) existing, string deployment, string[] modules) =>
        existing.Deployment == deployment && existing.Modules.SequenceEqual(modules.Order(StringComparer.Ordinal));

    private static async Task<(string Deployment, string[] Modules)?> ReadAsync(NpgsqlConnection connection, string schema,
        CancellationToken cancellationToken)
    {
        await using var read = new NpgsqlCommand("SELECT deployment, modules FROM messaging_deployments WHERE schema_name=@schema", connection);
        read.Parameters.AddWithValue("schema", schema);
        await using var row = await read.ExecuteReaderAsync(cancellationToken);
        return await row.ReadAsync(cancellationToken) ? (row.GetString(0), row.GetFieldValue<string[]>(1)) : null;
    }
}

/// <summary>Runs before Wolverine starts: this host's deployment, schema and module set must match provisioning.</summary>
internal sealed class MessagingDeploymentGuard(MessagingHost host, MessagingSettings settings,
    Microsoft.Extensions.Configuration.IConfiguration configuration) : Microsoft.Extensions.Hosting.IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken) => MessagingDeployments.ValidateAsync(
        Microsoft.Extensions.Configuration.ConfigurationExtensions.GetConnectionString(configuration, "Vessel")!,
        settings.SchemaFor(host.Deployment), host.Deployment, host.RunningModules.Select(m => m.Name).ToArray(), cancellationToken);

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

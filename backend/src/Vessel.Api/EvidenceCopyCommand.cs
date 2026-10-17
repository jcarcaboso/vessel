using System.Data;
using Microsoft.Extensions.Options;
using Npgsql;
using Vessel.Application.Evidence;
using Vessel.Infrastructure.Evidence;

namespace Vessel.Api;

/// <summary>Administrative CLI only: no HTTP listener, schema migration, database writes or provider switch.</summary>
public static class EvidenceCopyCommand
{
    private const string Usage = """
        Usage: dotnet Vessel.Api.dll evidence-copy-to-s3 --source /absolute/evidence/root [--apply]
               dotnet Vessel.Api.dll evidence-copy-to-local --destination /absolute/evidence/root [--apply]
        Stop API/web writers and take coordinated backups first.
        Reads ConnectionStrings__Vessel and Vessel__Evidence__Storage__S3__* from server configuration.
        Dry run by default; --apply copies and downloads/verifies each referenced original.
        Originals, database records and active-provider configuration are never changed.
        """;

    public static async Task<int> RunAsync(string[] args, TextWriter output, bool toLocal = false, CancellationToken ct = default)
    {
        if (args is ["--help"])
        {
            await output.WriteLineAsync(Usage);
            return 0;
        }
        var option = toLocal ? "--destination" : "--source";
        var apply = args.Length == 3 && args[2] == "--apply";
        if ((args.Length != 2 && !apply) || args[0] != option || !Path.IsPathFullyQualified(args[1]))
        {
            await output.WriteLineAsync(Usage);
            return 2;
        }
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(ct);
        ConsoleCancelEventHandler interrupted = (_, e) => { e.Cancel = true; cancellation.Cancel(); };
        Console.CancelKeyPress += interrupted;
        try
        {
            var configuration = new ConfigurationBuilder()
                .SetBasePath(AppContext.BaseDirectory)
                .AddJsonFile("appsettings.json", optional: true)
                .AddEnvironmentVariables()
                // Select the remote side for this process only, regardless of the API's active provider.
                .AddInMemoryCollection(new Dictionary<string, string?> { ["Vessel:Evidence:Storage:Provider"] = "S3" })
                .Build();
            var connectionString = configuration.GetConnectionString("Vessel");
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                await output.WriteLineAsync("ConnectionStrings__Vessel is required. Nothing was copied.");
                return 2;
            }
            var services = new ServiceCollection();
            Vessel.Infrastructure.DependencyInjection.AddEvidenceStorage(services, configuration);
            await using var provider = services.BuildServiceProvider();
            var remote = provider.GetRequiredService<IEvidenceObjectStore>();
            var copy = toLocal ? new EvidenceStorageCopy(remote, args[1]) : new EvidenceStorageCopy(args[1], remote);
            var token = cancellation.Token;
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(token);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, token);
            await using (var readOnly = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, transaction))
                await readOnly.ExecuteNonQueryAsync(token);
            // Deliberately all owners: this offline administrator operation copies the database's complete evidence set.
            await using var command = new NpgsqlCommand(
                """SELECT "ObjectKey", "SizeBytes", "Sha256" FROM play_evidence ORDER BY "ObjectKey" """, connection, transaction);
            await using var reader = await command.ExecuteReaderAsync(token);
            long count = 0, bytes = 0, copies = 0;
            while (await reader.ReadAsync(token))
            {
                var size = reader.GetInt64(1);
                if (await copy.CopyAsync(reader.GetString(0), size, reader.GetString(2), apply, token)) copies++;
                count++;
                bytes = checked(bytes + size);
            }
            await output.WriteLineAsync(
                $"{(apply ? "Copy" : "Dry run")} complete: {count} referenced images, {bytes} bytes; " +
                $"{copies} {(apply ? "copied and verified" : "would be copied")}, {count - copies} already verified.");
            await output.WriteLineAsync("No source images, database records or configuration were changed. Keep the originals and backups.");
            return 0;
        }
        catch (OperationCanceledException)
        {
            await output.WriteLineAsync("Copy cancelled. Originals are unchanged; verified copies may remain. Do not switch providers.");
            return 130;
        }
        catch (OptionsValidationException error)
        {
            // Evidence validation reports configuration keys only, never their values.
            await output.WriteLineAsync("Invalid S3 configuration: " + string.Join(" ", error.Failures));
            return 2;
        }
        catch (EvidenceCopyIntegrityException error)
        {
            // These messages are fixed integrity failures from EvidenceStorageCopy, not provider responses.
            await output.WriteLineAsync("Copy stopped: " + error.Message + " Originals are unchanged. Do not switch providers.");
            return 1;
        }
        catch (Exception)
        {
            // Never echo connection strings, paths, credentials or SDK/database exception payloads.
            await output.WriteLineAsync("Copy failed. Check local files, database access and S3 configuration. Originals are unchanged; " +
                "partial copies may remain. Do not switch providers; rerun after resolving the failure.");
            return 1;
        }
        finally { Console.CancelKeyPress -= interrupted; }
    }
}

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Vessel.Application.Common;

namespace Vessel.Identity;

public static class IdentityCommands
{
    private const string Usage = """
        Usage: dotnet Vessel.Api.dll identity ensure-owner
               dotnet Vessel.Api.dll identity bind-wallet --user <guid> --address 0x… [--label <label>]
               dotnet Vessel.Api.dll identity invite [--note <note>] [--expires 7d] [--max-uses 1]
        """;

    public static async Task<int> RunAsync(string[] args, TextWriter output, CancellationToken ct = default)
    {
        try
        {
            // Match WebApplication.CreateBuilder: DOTNET_ENVIRONMENT overrides ASPNETCORE_ENVIRONMENT.
            var environment = Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ??
                Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";
            var commandArgs = new List<string>();
            var configArgs = new List<string>();
            for (var i = 0; i < args.Length; i++)
            {
                if (args[i].StartsWith("--Vessel:", StringComparison.Ordinal) || args[i].StartsWith("--ConnectionStrings:", StringComparison.Ordinal))
                {
                    configArgs.Add(args[i]);
                    if (!args[i].Contains('='))
                    {
                        if (i + 1 >= args.Length) { await output.WriteLineAsync(Usage); return 2; }
                        configArgs.Add(args[++i]);
                    }
                }
                else commandArgs.Add(args[i]);
            }
            var configuration = new ConfigurationBuilder().SetBasePath(AppContext.BaseDirectory)
                .AddJsonFile("appsettings.json", optional: true).AddJsonFile($"appsettings.{environment}.json", optional: true)
                .AddEnvironmentVariables().AddCommandLine(configArgs.ToArray()).Build();
            return await RunAsync(commandArgs.ToArray(), configuration,
                string.Equals(environment, "Development", StringComparison.OrdinalIgnoreCase), output, ct);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            await output.WriteLineAsync("The identity command failed. Check private configuration.");
            return 1;
        }
    }

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration, bool development,
        TextWriter output, CancellationToken ct = default)
    {
        try
        {
            if (args.Length == 0 || args[0] is not ("ensure-owner" or "bind-wallet" or "invite") ||
                !TryOptions(args[1..], out var options))
            {
                await output.WriteLineAsync(Usage); return 2;
            }
            if (args[0] == "ensure-owner" && options.Count != 0 ||
                args[0] == "bind-wallet" && (options.Keys.Any(x => x is not ("--user" or "--address" or "--label")) ||
                    !options.ContainsKey("--user") || !options.ContainsKey("--address")) ||
                args[0] == "invite" && options.Keys.Any(x => x is not ("--note" or "--expires" or "--max-uses")))
            {
                await output.WriteLineAsync(Usage); return 2;
            }
            var settings = IdentitySettings.Read(configuration, development);
            if (args[0] == "ensure-owner" && !settings.WalletMode)
            {
                await output.WriteLineAsync("Token mode: identity ensure-owner has nothing to do."); return 0;
            }
            if (!settings.WalletMode) { await output.WriteLineAsync("This command requires Wallet mode."); return 3; }
            if (settings.LegacyOwnerOverride && settings.OwnerId == Vessel.Application.Ownership.JournalOwner.Default)
                await output.WriteLineAsync("Warning: Vessel:Identity:AllowLegacyDefaultOwner permits the legacy default owner.");
            var connection = configuration.GetConnectionString("Vessel");
            if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("ConnectionStrings:Vessel is required.");
            var schema = new IdentitySchema(settings.Schema);
            var dbOptions = new DbContextOptionsBuilder<IdentityDbContext>();
            IdentityDbContext.Configure(dbOptions, connection, schema);
            var factory = new CommandContextFactory(dbOptions.Options, schema);
            var transactions = new IdentityTransaction(factory);
            switch (args[0])
            {
                case "ensure-owner":
                    await transactions.RunAsync(async db =>
                    {
                        if (!await db.Users.AnyAsync(x => x.Id == settings.OwnerId, ct))
                        {
                            var now = DateTimeOffset.UtcNow;
                            db.Users.Add(new IdentityUser { Id = settings.OwnerId, DisplayName = IdentityText.DisplayName(settings.OwnerName),
                                Role = "operator", CreatedAt = now, UpdatedAt = now });
                        }
                        return true;
                    }, ct);
                    await output.WriteLineAsync($"Ensured identity user {settings.OwnerId}.");
                    return 0;
                case "bind-wallet":
                    if (!Guid.TryParse(options["--user"], out var userId) || userId == Guid.Empty)
                    { await output.WriteLineAsync(Usage); return 2; }
                    var address = WalletSignatures.NormalizeAddress(options["--address"]);
                    var label = IdentityText.Label(options.GetValueOrDefault("--label"));
                    var bound = await transactions.RunAsync(async db =>
                    {
                        if (await IdentityTransaction.LockUserAsync(db, userId, ct) is null) return false;
                        var existing = await db.Wallets.SingleOrDefaultAsync(x => x.Address == address, ct);
                        if (existing is not null) return existing.UserId == userId;
                        db.Wallets.Add(new UserWallet { Id = Guid.NewGuid(), UserId = userId, Address = address, Label = label, AddedAt = DateTimeOffset.UtcNow });
                        return true;
                    }, ct);
                    await output.WriteLineAsync(bound ? $"Bound {WalletSignatures.Checksum(address)} to {userId}." : "The user is absent or the wallet belongs to another user.");
                    return bound ? 0 : 3;
                default:
                    var expires = options.GetValueOrDefault("--expires", "7d");
                    if (!expires.EndsWith('d') || !int.TryParse(expires[..^1], NumberStyles.None, CultureInfo.InvariantCulture, out var days) ||
                        days < 1 || !int.TryParse(options.GetValueOrDefault("--max-uses", "1"), NumberStyles.None,
                            CultureInfo.InvariantCulture, out var maxUses) || maxUses < 1)
                    { await output.WriteLineAsync(Usage); return 2; }
                    var note = IdentityText.Note(options.GetValueOrDefault("--note"));
                    var code = InvitationCodes.Create();
                    await transactions.RunAsync(db =>
                    {
                        var now = DateTimeOffset.UtcNow;
                        db.Invitations.Add(new Invitation { Id = Guid.NewGuid(), CodeHash = IdentityTokens.Hash(InvitationCodes.Normalize(code)),
                            Note = note, CreatedAt = now, ExpiresAt = now.AddDays(days), MaxUses = maxUses });
                        return Task.FromResult(true);
                    }, ct);
                    await output.WriteLineAsync(code);
                    return 0;
            }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Only our own validation text is safe; driver errors can contain connection details.
            var safe = error.Source == "Vessel.Identity" && error is InvalidOperationException or ProblemException;
            await output.WriteLineAsync(safe ? error.Message : "The identity command failed. Check private configuration and migrations.");
            return 1;
        }
    }

    private static bool TryOptions(string[] args, out Dictionary<string, string> options)
    {
        options = [];
        if (args.Length % 2 != 0) return false;
        for (var i = 0; i < args.Length; i += 2)
            if (!args[i].StartsWith("--", StringComparison.Ordinal) || !options.TryAdd(args[i], args[i + 1])) return false;
        return true;
    }

    private sealed class CommandContextFactory(DbContextOptions<IdentityDbContext> options, IdentitySchema schema) : IDbContextFactory<IdentityDbContext>
    {
        public IdentityDbContext CreateDbContext() => new(options, schema);
    }
}

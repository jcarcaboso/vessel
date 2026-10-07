using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Vessel.Application.Credentials;

namespace Vessel.Infrastructure.Credentials;

public sealed class CredentialSettings
{
    public const string Section = "Vessel:Credentials";
    public string? ActiveKeyId { get; set; }
    public Dictionary<string, string> Keys { get; set; } = new(StringComparer.Ordinal);
    public string? KeyFile { get; set; }
}

public static class CredentialRegistration
{
    public static IServiceCollection AddVesselCredentials(this IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<CredentialSettings>().Bind(config.GetSection(CredentialSettings.Section))
            .Validate(settings =>
            {
                try { using var ring = CredentialKeyRing.Load(settings); return true; }
                catch (CredentialStorageException) { return false; }
            }, "Vessel:Credentials key ring is invalid or unreadable. Configure 32-byte keys and an active key ID, or a mode-600 key file.")
            .ValidateOnStart();
        services.AddSingleton<ICredentialVault>(sp => new AesGcmCredentialVault(sp.GetRequiredService<IOptions<CredentialSettings>>().Value));
        return services;
    }
}

internal sealed class CredentialKeyRing(string? activeKeyId, Dictionary<string, byte[]> keys) : IDisposable
{
    internal string? ActiveKeyId => activeKeyId;
    internal Dictionary<string, byte[]> Keys => keys;

    internal static CredentialKeyRing Load(CredentialSettings settings)
    {
        var decoded = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var fromFile = settings.KeyFile is not null;
        try
        {
            if (settings.KeyFile is { } file)
            {
                // A key source is either a file or configuration/environment, never an implicit merge.
                if (string.IsNullOrWhiteSpace(file) || !Path.IsPathFullyQualified(file) ||
                    settings.ActiveKeyId is not null || settings.Keys.Count != 0 ||
                    OperatingSystem.IsWindows() || !File.Exists(file))
                    throw new CredentialStorageException();
                var info = new FileInfo(file);
                if (info.LinkTarget is not null || info.Length is <= 0 or > 65536 ||
                    File.GetUnixFileMode(file) != (UnixFileMode.UserRead | UnixFileMode.UserWrite))
                    throw new CredentialStorageException();
                var bytes = File.ReadAllBytes(file);
                try
                {
                    settings = JsonSerializer.Deserialize<CredentialSettings>(bytes,
                        new JsonSerializerOptions { UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow })
                        ?? throw new CredentialStorageException();
                    if (settings.KeyFile is not null) throw new CredentialStorageException();
                }
                finally { CryptographicOperations.ZeroMemory(bytes); }
            }
            if (settings.Keys.Count == 0 && settings.ActiveKeyId is null)
            {
                if (fromFile) throw new CredentialStorageException();
                return new(null, decoded);
            }
            if (settings.ActiveKeyId is null || !settings.Keys.ContainsKey(settings.ActiveKeyId) || settings.Keys.Count > 32)
                throw new CredentialStorageException();
            foreach (var (id, value) in settings.Keys)
            {
                if (id.Length is < 1 or > 64 || id.AsSpan().IndexOfAnyExcept("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") >= 0)
                    throw new CredentialStorageException();
                var key = Convert.FromBase64String(value);
                decoded.Add(id, key);
                if (key.Length != 32) throw new CredentialStorageException();
            }
            return new(settings.ActiveKeyId, decoded);
        }
        catch (Exception)
        {
            foreach (var key in decoded.Values) CryptographicOperations.ZeroMemory(key);
            // Configuration/file errors can contain keys or paths; never retain their inner exception.
            throw new CredentialStorageException();
        }
    }

    public void Dispose()
    {
        foreach (var key in keys.Values) CryptographicOperations.ZeroMemory(key);
        keys.Clear();
    }
}

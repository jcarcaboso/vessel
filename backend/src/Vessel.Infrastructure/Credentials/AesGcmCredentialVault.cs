using System.Security.Cryptography;
using System.Text;
using Vessel.Application.Credentials;
using Vessel.Domain.Credentials;

namespace Vessel.Infrastructure.Credentials;

public sealed class AesGcmCredentialVault : ICredentialVault, IDisposable
{
    private readonly CredentialKeyRing ring;
    public AesGcmCredentialVault(CredentialSettings settings) => ring = CredentialKeyRing.Load(settings);
    public bool IsConfigured => ring.ActiveKeyId is { } id && ring.Keys.ContainsKey(id);
    public bool HasKey(string keyId) => IsConfigured && ring.Keys.ContainsKey(keyId);

    public SealedCredential Seal(Guid ownerId, Guid accountId, string purpose, string plaintext)
    {
        if (!IsConfigured || string.IsNullOrEmpty(plaintext) || plaintext.Length > 512) throw new CredentialStorageException();
        var bytes = Encoding.UTF8.GetBytes(plaintext);
        try
        {
            var nonce = RandomNumberGenerator.GetBytes(12);
            var ciphertext = new byte[bytes.Length];
            var tag = new byte[16];
            using var aes = new AesGcm(ring.Keys[ring.ActiveKeyId!], 16);
            aes.Encrypt(nonce, bytes, ciphertext, tag, Aad(ownerId, accountId, purpose));
            return new(ring.ActiveKeyId!, nonce, ciphertext, tag);
        }
        catch (Exception) { throw new CredentialStorageException(); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    public string Open(Guid ownerId, Guid accountId, string purpose, SealedCredential credential)
    {
        if (!ring.Keys.TryGetValue(credential.KeyId, out var key) || credential.Nonce.Length != 12 ||
            credential.Tag.Length != 16 || credential.Ciphertext.Length is < 1 or > 2048)
            throw new CredentialStorageException();
        var bytes = new byte[credential.Ciphertext.Length];
        try
        {
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(credential.Nonce, credential.Ciphertext, credential.Tag, bytes, Aad(ownerId, accountId, purpose));
            return new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (Exception) { throw new CredentialStorageException(); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    private static byte[] Aad(Guid ownerId, Guid accountId, string purpose)
    {
        if (ownerId == Guid.Empty || accountId == Guid.Empty || string.IsNullOrWhiteSpace(purpose) || purpose.Length > 128 ||
            purpose.Contains('|', StringComparison.Ordinal))
            throw new CredentialStorageException();
        return Encoding.UTF8.GetBytes($"vessel:credential:v1|{ownerId:D}|{accountId:D}|{purpose}");
    }

    public void Dispose() => ring.Dispose();
}

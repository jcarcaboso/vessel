namespace Vessel.Domain.Credentials;

// Classes deliberately do not print their contents through a generated record ToString().
public sealed class SealedCredential(string keyId, byte[] nonce, byte[] ciphertext, byte[] tag)
{
    public string KeyId { get; } = keyId;
    public byte[] Nonce { get; } = nonce;
    public byte[] Ciphertext { get; } = ciphertext;
    public byte[] Tag { get; } = tag;
}

public sealed class AccountCredential
{
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public string Purpose { get; set; } = null!;
    public string KeyId { get; set; } = null!;
    public byte[] Nonce { get; set; } = null!;
    public byte[] Ciphertext { get; set; } = null!;
    public byte[] Tag { get; set; } = null!;
    public string Scope { get; set; } = null!;
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastVerifiedAt { get; set; }
    // Fixed application-owned status only. Never persist a venue response or exception.
    public string? LastError { get; set; }
    public SealedCredential Sealed() => new(KeyId, Nonce, Ciphertext, Tag);
}

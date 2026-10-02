namespace Vessel.Infrastructure.Evidence;

/// <summary>Binds <c>Vessel:Evidence</c>. Only the local provider exists; S3-compatible storage comes later.</summary>
public sealed class EvidenceSettings
{
    public const string Section = "Vessel:Evidence";
    public const string LocalProvider = "Local";

    public long MaxUploadBytes { get; set; } = 10 * 1024 * 1024;
    public int MaxPerPlay { get; set; } = 50;
    public EvidenceStorageSettings Storage { get; set; } = new();
}

public sealed class EvidenceStorageSettings
{
    public string Provider { get; set; } = EvidenceSettings.LocalProvider;
    public LocalEvidenceStorageSettings Local { get; set; } = new();
}

public sealed class LocalEvidenceStorageSettings
{
    /// <summary>Absolute, or relative to the API content root.</summary>
    public string RootPath { get; set; } = "data/evidence";
}

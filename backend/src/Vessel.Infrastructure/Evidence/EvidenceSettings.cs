namespace Vessel.Infrastructure.Evidence;

/// <summary>Binds <c>Vessel:Evidence</c>. Credentials are server-only configuration.</summary>
public sealed class EvidenceSettings
{
    public const string Section = "Vessel:Evidence";
    public const string LocalProvider = "Local";
    public const string S3Provider = "S3";

    public long MaxUploadBytes { get; set; } = 10 * 1024 * 1024;
    public int MaxPerPlay { get; set; } = 50;
    public EvidenceStorageSettings Storage { get; set; } = new();
}

public sealed class EvidenceStorageSettings
{
    public string Provider { get; set; } = EvidenceSettings.LocalProvider;
    public LocalEvidenceStorageSettings Local { get; set; } = new();
    public S3EvidenceStorageSettings S3 { get; set; } = new();
}

public sealed class S3EvidenceStorageSettings
{
    public string Endpoint { get; set; } = "http://localhost:9000";
    public string Bucket { get; set; } = "vessel-evidence";
    public string Region { get; set; } = "us-east-1";
    public bool ForcePathStyle { get; set; } = true;
    public string AccessKeyId { get; set; } = "";
    public string SecretAccessKey { get; set; } = "";
}

public sealed class LocalEvidenceStorageSettings
{
    /// <summary>Absolute, or relative to the API content root.</summary>
    public string RootPath { get; set; } = "data/evidence";
}

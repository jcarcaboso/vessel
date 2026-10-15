using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Vessel.Infrastructure.Evidence;

internal sealed partial class EvidenceStorageValidation : IValidateOptions<EvidenceSettings>
{
    public ValidateOptionsResult Validate(string? name, EvidenceSettings settings)
    {
        var failures = new List<string>();
        if (settings.MaxUploadBytes <= 0 || settings.MaxPerPlay <= 0)
            failures.Add("Vessel:Evidence limits must be positive.");
        switch (settings.Storage.Provider)
        {
            case EvidenceSettings.LocalProvider:
                if (string.IsNullOrWhiteSpace(settings.Storage.Local.RootPath))
                    failures.Add("Vessel:Evidence:Storage:Local:RootPath is required.");
                break;
            case EvidenceSettings.S3Provider:
                var s3 = settings.Storage.S3;
                if (!Uri.TryCreate(s3.Endpoint, UriKind.Absolute, out var uri) ||
                    uri.Scheme is not ("http" or "https") || string.IsNullOrEmpty(uri.Host) ||
                    uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/")
                    failures.Add("Vessel:Evidence:Storage:S3:Endpoint must be an HTTP(S) origin without credentials, a path, query or fragment.");
                if (!BucketPattern().IsMatch(s3.Bucket) || s3.Bucket.Contains("..", StringComparison.Ordinal) ||
                    System.Net.IPAddress.TryParse(s3.Bucket, out _))
                    failures.Add("Vessel:Evidence:Storage:S3:Bucket must be a valid S3 bucket name (3–63 lowercase letters, digits, dots or hyphens).");
                if (string.IsNullOrWhiteSpace(s3.Region))
                    failures.Add("Vessel:Evidence:Storage:S3:Region is required.");
                if (string.IsNullOrWhiteSpace(s3.AccessKeyId) || string.IsNullOrWhiteSpace(s3.SecretAccessKey))
                    failures.Add("Vessel:Evidence:Storage:S3:AccessKeyId and SecretAccessKey are required.");
                break;
            default:
                failures.Add("Vessel:Evidence:Storage:Provider must be Local or S3.");
                break;
        }
        // Never include values: malformed endpoint/credential settings may contain secrets.
        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    [GeneratedRegex(@"\A[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\z")]
    private static partial Regex BucketPattern();
}

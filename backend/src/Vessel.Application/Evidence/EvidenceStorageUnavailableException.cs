namespace Vessel.Application.Evidence;

/// <summary>
/// A transient object-storage failure: the store could not be reached, timed out, throttled the request or reported a
/// server error. Hosts report it as a temporary dependency outage. The message is fixed and never carries a bucket,
/// endpoint, key or provider response; the provider exception is kept only as the inner exception for diagnostics.
/// Configuration, permission and missing-object failures are not wrapped.
/// </summary>
public sealed class EvidenceStorageUnavailableException(Exception innerException)
    : Exception("Evidence storage is temporarily unavailable.", innerException);

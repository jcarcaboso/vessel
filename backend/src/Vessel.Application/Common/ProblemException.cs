namespace Vessel.Application.Common;

/// <summary>An expected failure of a request: the API answers with <see cref="StatusCode"/> and this safe message.</summary>
public sealed class ProblemException(int statusCode, string detail, string? code = null, int? retryAfterSeconds = null) : Exception(detail)
{
    public int StatusCode { get; } = statusCode;

    /// <summary>A stable machine-readable code, returned as the ProblemDetails <c>code</c> extension when set.</summary>
    public string? Code { get; } = code;

    /// <summary>Seconds for the <c>Retry-After</c> header, written by the API error handler after it clears the response.</summary>
    public int? RetryAfterSeconds { get; } = retryAfterSeconds is null or > 0 ? retryAfterSeconds : throw new ArgumentOutOfRangeException(nameof(retryAfterSeconds));
}

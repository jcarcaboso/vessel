namespace Vessel.Application.Common;

/// <summary>An expected failure of a request: the API answers with <see cref="StatusCode"/> and this safe message.</summary>
public sealed class ProblemException(int statusCode, string detail) : Exception(detail)
{
    public int StatusCode { get; } = statusCode;
}

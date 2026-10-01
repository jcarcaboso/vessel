using System.Diagnostics;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace Vessel.Api;

internal static class SafeExceptionDiagnostics
{
    public static bool IsDependencyOutage(Exception error)
    {
        // Persistence deliberately resolves missing configuration lazily. Match its code
        // origin, not its message; unrelated InvalidOperationExceptions are still bugs.
        if (error is InvalidOperationException &&
            error.TargetSite?.DeclaringType?.DeclaringType == typeof(Vessel.Persistence.DependencyInjection))
            return true;
        // EF wraps transient Npgsql failures (refused connections, timeouts) in an
        // InvalidOperationException or DbUpdateException, so inspect the whole chain.
        for (var current = error; current is not null; current = current.InnerException)
        {
            switch (current)
            {
                case NpgsqlException database:
                    return database.IsTransient;
                case HttpRequestException { StatusCode: null }:
                    return true;
                case HttpRequestException { StatusCode: { } status }:
                    return (int)status >= 500;
            }
        }
        return false;
    }

    public static void Log(ILogger logger, HttpContext context, Exception error, string traceId, int status)
    {
        // Never pass the exception to ILogger: formatters include Message, Data, inner
        // exceptions and file paths. Keep only bounded code metadata, without arguments.
        var stack = string.Join(" <- ", (new StackTrace(error, false).GetFrames() ?? [])
            .Take(12).Select(frame => frame.GetMethod())
            .Where(method => method is not null)
            .Select(method => $"{method!.DeclaringType?.FullName}.{method.Name}"));
        var operation = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "(unmatched)";
        logger.LogError(new EventId(1001, "UnexpectedRequestFailure"),
            "Request failed: TraceId={TraceId} Operation={Operation} ExceptionType={ExceptionType} StatusCode={StatusCode} SafeStack={SafeStack}",
            traceId, operation, error.GetType().FullName, status, stack);
    }
}

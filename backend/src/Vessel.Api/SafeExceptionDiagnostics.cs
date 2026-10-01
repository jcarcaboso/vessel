using System.Diagnostics;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Vessel.Api;

internal static class SafeExceptionDiagnostics
{
    public static bool IsDependencyOutage(Exception error) => error switch
    {
        NpgsqlException database => database.IsTransient,
        DbUpdateException { InnerException: NpgsqlException database } => database.IsTransient,
        HttpRequestException { StatusCode: null } => true,
        HttpRequestException { StatusCode: { } status } => (int)status >= 500,
        // Persistence deliberately resolves missing configuration lazily. Match its code
        // origin, not its message; unrelated InvalidOperationExceptions are still bugs.
        InvalidOperationException when error.TargetSite?.DeclaringType?.DeclaringType ==
            typeof(Vessel.Persistence.DependencyInjection) => true,
        _ => false
    };

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

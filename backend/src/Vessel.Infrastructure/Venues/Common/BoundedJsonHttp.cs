using System.Text.Json;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Common;

/// <summary>
/// Bounded venue reads: one deadline for a whole multi-request read, a response size cap, strict parsing and
/// duplicate-key rejection. Failures become <see cref="VenueReadException"/> with the venue's safe messages.
/// </summary>
public sealed class BoundedJsonHttp(HttpClient httpClient, TimeProvider timeProvider, StrictJson json,
    string unavailable, string timedOut, int maxResponseBytes = 4 * 1024 * 1024, int maxDepth = 32)
{
    public static readonly TimeSpan Deadline = TimeSpan.FromSeconds(20);

    /// <summary>Runs <paramref name="read"/> under one deadline and maps transport and parse failures.</summary>
    public async Task<T> ReadBoundedAsync<T>(Func<CancellationToken, Task<T>> read, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        // ResponseHeadersRead does not apply HttpClient.Timeout to streamed bodies.
        // Bound the entire operation, not each individual request.
        using var deadline = new CancellationTokenSource(Deadline, timeProvider);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        try
        {
            var result = await read(linked.Token);
            linked.Token.ThrowIfCancellationRequested();
            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw new VenueReadException(timedOut);
        }
        catch (HttpRequestException)
        {
            throw new VenueReadException(unavailable);
        }
        catch (IOException)
        {
            throw new VenueReadException(unavailable);
        }
        catch (JsonException)
        {
            throw json.Invalid();
        }
        catch (InvalidOperationException)
        {
            throw json.Invalid();
        }
    }

    /// <summary>Sends <paramref name="request"/> and parses a bounded JSON body. The caller disposes the document.</summary>
    public async Task<JsonDocument> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new VenueReadException(unavailable);
        if (response.Content.Headers.ContentLength > maxResponseBytes)
            throw json.Invalid();

        using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var bytes = new MemoryStream();
        var buffer = new byte[16384];
        int count;
        while ((count = await body.ReadAsync(buffer, cancellationToken)) != 0)
        {
            if (bytes.Length + count > maxResponseBytes)
                throw json.Invalid();
            bytes.Write(buffer, 0, count);
        }
        var document = JsonDocument.Parse(bytes.ToArray(), new JsonDocumentOptions { MaxDepth = maxDepth });
        try
        {
            json.RejectDuplicateProperties(document.RootElement);
            return document;
        }
        catch
        {
            document.Dispose();
            throw;
        }
    }
}

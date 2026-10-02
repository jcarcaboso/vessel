using System.Net.WebSockets;
using System.Text;

namespace Vessel.Infrastructure.Venues.Hyperliquid;

/// <summary>Minimal text WebSocket seam so the shared market stream can be tested without a network.</summary>
public interface IWebSocketTransport : IAsyncDisposable
{
    Task ConnectAsync(Uri uri, CancellationToken cancellationToken);
    Task SendTextAsync(string message, CancellationToken cancellationToken);

    /// <summary>Returns one complete message, or null when the peer closed the socket.</summary>
    /// <exception cref="InvalidDataException">The message exceeds <paramref name="maxBytes"/>.</exception>
    Task<byte[]?> ReceiveAsync(int maxBytes, CancellationToken cancellationToken);

    Task CloseAsync(CancellationToken cancellationToken);
}

public interface IWebSocketTransportFactory
{
    IWebSocketTransport Create();
}

public sealed class ClientWebSocketTransportFactory : IWebSocketTransportFactory
{
    public IWebSocketTransport Create() => new ClientWebSocketTransport();
}

internal sealed class ClientWebSocketTransport : IWebSocketTransport
{
    private readonly ClientWebSocket socket = new();

    public Task ConnectAsync(Uri uri, CancellationToken cancellationToken) => socket.ConnectAsync(uri, cancellationToken);

    public Task SendTextAsync(string message, CancellationToken cancellationToken) =>
        socket.SendAsync(Encoding.UTF8.GetBytes(message), WebSocketMessageType.Text, true, cancellationToken);

    public async Task<byte[]?> ReceiveAsync(int maxBytes, CancellationToken cancellationToken)
    {
        var buffer = new byte[16384];
        using var message = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
                return null;
            if (message.Length + result.Count > maxBytes)
                throw new InvalidDataException("The upstream message exceeds the size bound.");
            message.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
                return message.ToArray();
        }
    }

    public async Task CloseAsync(CancellationToken cancellationToken)
    {
        if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, cancellationToken);
    }

    public ValueTask DisposeAsync()
    {
        socket.Dispose();
        return ValueTask.CompletedTask;
    }
}

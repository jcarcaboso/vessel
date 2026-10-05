using Vessel.Application.MarketData;

namespace Vessel.Application.Venues;

/// <summary>
/// Finds the descriptor and adapters for a venue ID. A missing adapter means the venue does not offer that capability
/// (or is not available); callers turn that into their own safe error.
/// </summary>
public interface IVenueRegistry
{
    IReadOnlyList<VenueDescriptor> Descriptors { get; }
    VenueDescriptor? Descriptor(string venueId);
    IPerpetualVenueReader? Reader(string venueId);
    IVenueOrderReader? Orders(string venueId);
    ICandleReader? Candles(string venueId);
    IMarketContextReader? MarketContext(string venueId);
    IMarketStream? Stream(string venueId);
}

/// <summary>
/// Registry over the registered descriptors and adapters. When a venue has several registrations of one port the
/// last one wins, matching how a single injected service resolves.
/// </summary>
public sealed class VenueRegistry(
    IEnumerable<VenueDescriptor> descriptors, IEnumerable<IPerpetualVenueReader> readers,
    IEnumerable<IVenueOrderReader> orders, IEnumerable<ICandleReader> candles,
    IEnumerable<IMarketContextReader> contexts, IEnumerable<IMarketStream> streams) : IVenueRegistry
{
    private readonly IReadOnlyList<VenueDescriptor> descriptors = descriptors.GroupBy(d => d.Id).Select(g => g.Last()).ToList();
    private readonly Dictionary<string, IPerpetualVenueReader> readers = Last(readers, r => r.VenueId);
    private readonly Dictionary<string, IVenueOrderReader> orders = Last(orders, r => r.VenueId);
    private readonly Dictionary<string, ICandleReader> candles = Last(candles, r => r.VenueId);
    private readonly Dictionary<string, IMarketContextReader> contexts = Last(contexts, r => r.VenueId);
    private readonly Dictionary<string, IMarketStream> streams = Last(streams, r => r.VenueId);

    public IReadOnlyList<VenueDescriptor> Descriptors => descriptors;
    public VenueDescriptor? Descriptor(string venueId) => descriptors.FirstOrDefault(d => d.Id == venueId);
    public IPerpetualVenueReader? Reader(string venueId) => readers.GetValueOrDefault(venueId);
    public IVenueOrderReader? Orders(string venueId) => orders.GetValueOrDefault(venueId);
    public ICandleReader? Candles(string venueId) => candles.GetValueOrDefault(venueId);
    public IMarketContextReader? MarketContext(string venueId) => contexts.GetValueOrDefault(venueId);
    public IMarketStream? Stream(string venueId) => streams.GetValueOrDefault(venueId);

    private static Dictionary<string, T> Last<T>(IEnumerable<T> items, Func<T, string> venue) =>
        items.GroupBy(venue, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Last(), StringComparer.Ordinal);
}

using System.Text.Json;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Common;

/// <summary>Raw rows establish caps and observation boundaries independently of imported-fact exclusions.</summary>
internal sealed class RawFillReadCoverage
{
    private bool timestampsKnown = true;
    public int Count { get; private set; }
    public DateTimeOffset? OldestAtUtc { get; private set; }

    public void Observe(JsonElement rows, Func<JsonElement, DateTimeOffset> timestamp)
    {
        foreach (var row in rows.EnumerateArray())
        {
            Count++;
            if (!timestampsKnown) continue;
            try
            {
                var at = timestamp(row);
                if (OldestAtUtc is null || at < OldestAtUtc) OldestAtUtc = at;
            }
            catch (VenueReadException)
            {
                // Excluded rows were not required to carry valid timestamps before this coverage check.
                // Do not turn their parse gaps into new read failures or use the filtered oldest instead.
                timestampsKnown = false;
                OldestAtUtc = null;
            }
        }
    }
}

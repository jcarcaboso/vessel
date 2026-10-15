using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vessel.Persistence.Events;

/// <summary>The event serialization policy for storage: web casing.</summary>
public static class VesselEventJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static JsonElement Element<T>(T value) => JsonSerializer.SerializeToElement(value, Options);
}

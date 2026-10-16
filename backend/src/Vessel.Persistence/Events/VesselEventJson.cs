using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vessel.Persistence.Events;

/// <summary>The one event serialization policy: web casing, and an absent value is an explicit null.</summary>
public static class VesselEventJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    public static JsonElement Element<T>(T value) => JsonSerializer.SerializeToElement(value, Options);
}

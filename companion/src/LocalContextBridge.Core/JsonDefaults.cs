using System.Text.Json;
using System.Text.Json.Serialization;

namespace LocalContextBridge.Core;

/// <summary>
/// Single shared <see cref="JsonSerializerOptions"/> instance used across the companion so that
/// wire payloads (camelCase, matching the protocol schemas) are produced consistently.
/// </summary>
public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            WriteIndented = false,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}

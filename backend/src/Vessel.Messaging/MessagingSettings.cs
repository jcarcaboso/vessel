namespace Vessel.Messaging;

/// <summary>Broker and envelope-storage settings shared by every host that publishes or runs modules.</summary>
public sealed class MessagingSettings
{
    public const string Section = "Vessel:Messaging";
    public string RabbitMqUri { get; set; } = "";
    /// <summary>Topology name prefix: <c>{prefix}.events</c>, <c>{prefix}.events.sub.{name}</c>, <c>{prefix}.commands.{name}</c>.</summary>
    public string Prefix { get; set; } = "vessel";
    /// <summary>Explicit envelope schema per logical deployment (<c>api</c> or a module name). Unlisted ones use <c>wolverine_{name}</c>.</summary>
    public Dictionary<string, string> StorageSchemas { get; set; } = new(StringComparer.Ordinal);
    /// <summary>Quorum <c>x-delivery-limit</c>: a transport guard only. Receipt attempts are the business retry limit.</summary>
    public int DeliveryLimit { get; set; } = 20;
    /// <summary>Compiles the verification subscription into the registry, for release checks and tests only.</summary>
    public bool Verification { get; set; }

    public string SchemaFor(string deployment) =>
        StorageSchemas.TryGetValue(deployment, out var schema) ? schema : "wolverine_" + deployment.Replace('-', '_');

    public Uri BrokerUri() =>
        Uri.TryCreate(RabbitMqUri, UriKind.Absolute, out var amqp) && amqp.Scheme is "amqp" or "amqps"
            ? amqp : throw new InvalidOperationException("Vessel:Messaging:RabbitMqUri must configure the broker.");

    public void Validate()
    {
        if (!MessagingNames.ValidPrefix(Prefix) || DeliveryLimit is < 1 or > 1000 ||
            StorageSchemas.Any(pair => !MessagingNames.ValidName(pair.Key) || !MessagingNames.ValidSchema(pair.Value)))
            throw new InvalidOperationException("Invalid Vessel:Messaging settings.");
        BrokerUri();
    }
}

/// <summary>Validated identifiers; only these reach SQL schema names or broker topology.</summary>
public static class MessagingNames
{
    public static bool ValidName(string name) => name.Length is >= 1 and <= 48 &&
        char.IsAsciiLetterLower(name[0]) && name.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '-');

    public static bool ValidPrefix(string prefix) => prefix.Length is >= 1 and <= 48 &&
        char.IsAsciiLetterLower(prefix[0]) && prefix.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c is '-' or '.');

    public static bool ValidSchema(string schema) => schema.Length is >= 1 and <= 63 &&
        char.IsAsciiLetterLower(schema[0]) && schema.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '_');
}

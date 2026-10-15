namespace Vessel.Persistence.Events;

public sealed class PlayEventSettings
{
    public const string Section = "Vessel:Events";
    public int RetentionDays { get; set; } = 90;
    public int CatchupSeconds { get; set; } = 2;
    // Bound from Vessel:Monitor:Interval, not worker types or the Events section.
    public TimeSpan MonitorInterval { get; set; } = TimeSpan.FromMinutes(10);
    public string RabbitMqUri { get; set; } = "";
    public string ApiStorageSchema { get; set; } = "wolverine_api";
    public string WorkerStorageSchema { get; set; } = "wolverine_worker";
    // Named durable consumers are declared before producers start, not invented at publication time.
    public string[] DurableConsumers { get; set; } = ["monitor"];

    public string Timeliness(DateTimeOffset occurred, DateTimeOffset detected) =>
        detected - occurred > MonitorInterval * 2 ? "late" : "timely";

    internal static bool ValidSchema(string schema) => schema.Length is >= 1 and <= 63 &&
        char.IsAsciiLetterLower(schema[0]) && schema.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '_');
}

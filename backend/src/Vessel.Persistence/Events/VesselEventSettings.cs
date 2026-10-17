namespace Vessel.Persistence.Events;

public sealed class VesselEventSettings
{
    public const string Section = "Vessel:Events";
    public int RetentionDays { get; set; } = 90;
    /// <summary>Pause between empty reads of the browser event stream.</summary>
    public int StreamPollSeconds { get; set; } = 2;
    /// <summary>
    /// Longest one browser event stream stays open. The server then ends the response cleanly between frames and
    /// the browser reconnects from its last cursor.
    /// </summary>
    public TimeSpan StreamMaxLifetime { get; set; } = TimeSpan.FromMinutes(30);
    /// <summary>Rows per physical retention deletion batch.</summary>
    public int RetentionBatch { get; set; } = 1000;
    // Bound from Vessel:Monitor:Interval, not worker types or the Events section.
    public TimeSpan MonitorInterval { get; set; } = TimeSpan.FromMinutes(10);

    public string Timeliness(DateTimeOffset occurred, DateTimeOffset detected) =>
        detected - occurred > MonitorInterval * 2 ? "late" : "timely";

    internal bool Valid() => RetentionDays is >= 1 and <= 36500 && StreamPollSeconds is >= 1 and <= 60 &&
        StreamMaxLifetime >= TimeSpan.FromSeconds(1) && StreamMaxLifetime <= TimeSpan.FromHours(24) &&
        RetentionBatch is >= 1 and <= 10000 && MonitorInterval >= TimeSpan.FromMinutes(1) && MonitorInterval <= TimeSpan.FromMinutes(60);
}

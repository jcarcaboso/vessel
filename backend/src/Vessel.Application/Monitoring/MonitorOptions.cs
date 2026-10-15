namespace Vessel.Application.Monitoring;

public sealed class MonitorOptions
{
    public TimeSpan Interval { get; set; } = TimeSpan.FromMinutes(10);
    public TimeSpan ProtectionGrace { get; set; } = TimeSpan.FromMinutes(10);
    public TimeSpan ManualCooldown { get; set; } = TimeSpan.FromSeconds(60);
    public TimeSpan HeartbeatTimeout { get; set; } = TimeSpan.FromSeconds(90);
    public string HeartbeatFile { get; set; } = "/tmp/vessel-worker-heartbeat";
    public static readonly TimeSpan SchedulerTick = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(5);

    public void Validate()
    {
        if (Interval < TimeSpan.FromMinutes(1) || Interval > TimeSpan.FromMinutes(60))
            throw new InvalidOperationException("Vessel:Monitor:Interval must be between 1 and 60 minutes.");
        if (ProtectionGrace < TimeSpan.Zero || ProtectionGrace > TimeSpan.FromHours(24) ||
            ManualCooldown < TimeSpan.Zero || ManualCooldown > TimeSpan.FromHours(1) ||
            HeartbeatTimeout < SchedulerTick || HeartbeatTimeout > TimeSpan.FromMinutes(10))
            throw new InvalidOperationException("The monitor grace, cooldown or heartbeat timeout is outside its supported range.");
    }

    public TimeSpan NextDelay(int failures, double jitter) => failures switch
    {
        1 => TimeSpan.FromMinutes(1),
        2 => TimeSpan.FromMinutes(3),
        _ => TimeSpan.FromTicks((long)(Interval.Ticks * (0.9 + Math.Clamp(jitter, 0, 1) * 0.2)))
    };
}

using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Vessel.Persistence.Migrations;

/// <summary>Offline upgrade: discard owner heartbeat liveness; deployment health starts with a productive pass.</summary>
[DbContext(typeof(VesselDbContext))]
[Migration("20261018120000_ServerNotificationState")]
public sealed class ServerNotificationState : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        CREATE TABLE server_notification_heartbeats (
            deployment varchar(48) PRIMARY KEY,
            seen_at timestamp with time zone NOT NULL
        );
        DROP TABLE notification_heartbeats;
        """);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Stop all processes and restore the pre-B2 backup to roll back notification worker state.");
}

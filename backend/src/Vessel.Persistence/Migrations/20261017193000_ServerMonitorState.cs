using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Vessel.Persistence.Migrations;

/// <summary>
/// Offline upgrade only: stop every API and worker before applying. A pre-B2 image requires restoring the
/// pre-upgrade backup; a down migration cannot reconstruct the discarded per-owner heartbeat/deadline facts.
/// </summary>
[DbContext(typeof(VesselDbContext))]
[Migration("20261017193000_ServerMonitorState")]
public sealed class ServerMonitorState : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        CREATE TABLE server_monitor_heartbeats (
            deployment varchar(48) PRIMARY KEY,
            seen_at timestamp with time zone NOT NULL
        );
        CREATE TABLE server_venue_deadlines (
            venue_id varchar(40) PRIMARY KEY,
            retry_after_until timestamp with time zone NOT NULL
        );
        INSERT INTO server_venue_deadlines (venue_id, retry_after_until)
            SELECT "VenueId", MAX("RetryAtUtc") FROM monitor_venue_budgets GROUP BY "VenueId";
        DROP TABLE monitor_venue_budgets;
        DROP TABLE monitor_heartbeats;
        CREATE INDEX "IX_monitor_accounts_due" ON monitor_accounts ("NextRunAtUtc", "OwnerId", "AccountId");
        """);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Stop all processes and restore the pre-B2 backup to roll back server monitor state.");
}

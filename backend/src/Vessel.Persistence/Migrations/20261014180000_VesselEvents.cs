using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Vessel.Persistence.Migrations;

// Event storage uses explicit owner predicates and the current EF transaction, not EF-tracked entities.
[DbContext(typeof(VesselDbContext))]
[Migration("20261014180000_VesselEvents")]
public sealed class VesselEvents : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        CREATE TABLE event_cursors (
            owner_id uuid PRIMARY KEY, sequence bigint NOT NULL DEFAULT 0 CHECK(sequence >= 0),
            retention_floor bigint NOT NULL DEFAULT 0 CHECK(retention_floor >= 0)
        );
        CREATE TABLE events (
            owner_id uuid NOT NULL, sequence bigint NOT NULL CHECK(sequence > 0), event_id uuid NOT NULL,
            type varchar(80) NOT NULL, detected_at timestamptz NOT NULL, payload jsonb NOT NULL,
            PRIMARY KEY(owner_id, sequence), UNIQUE(owner_id, event_id)
        );
        CREATE INDEX ix_events_retention ON events(detected_at);
        CREATE TABLE event_dedup (
            owner_id uuid NOT NULL, dedup_key varchar(1024) NOT NULL, event_id uuid NOT NULL,
            PRIMARY KEY(owner_id, dedup_key)
        );
        CREATE INDEX ix_event_dedup_identity ON event_dedup(owner_id,event_id);
        CREATE TABLE event_baselines (
            owner_id uuid NOT NULL, account_id uuid NOT NULL, started_at timestamptz NOT NULL,
            PRIMARY KEY(owner_id, account_id)
        );
        CREATE TABLE event_fills (
            owner_id uuid NOT NULL, account_id uuid NOT NULL, contract_id varchar(128) NOT NULL,
            source_fill_id varchar(256) NOT NULL, event_id uuid NULL,
            PRIMARY KEY(owner_id, account_id, contract_id, source_fill_id)
        );
        CREATE TABLE event_deliveries (
            owner_id uuid NOT NULL, event_id uuid NOT NULL, consumer varchar(128) NOT NULL,
            state varchar(16) NOT NULL DEFAULT 'pending'
                CHECK(state IN ('pending','failed','delivered','skipped','expired')),
            attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0), completed_at timestamptz NULL,
            last_republished_at timestamptz NULL,
            PRIMARY KEY(owner_id,event_id,consumer)
        );
        CREATE INDEX ix_event_deliveries_pending ON event_deliveries(owner_id,event_id)
            WHERE state IN ('pending','failed');
        CREATE TABLE event_envelopes (
            owner_id uuid NOT NULL, event_id uuid NOT NULL, schema_name varchar(63) NOT NULL,
            envelope_id uuid NOT NULL, PRIMARY KEY(owner_id,event_id,schema_name,envelope_id)
        );
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DROP TABLE event_deliveries;
        DROP TABLE event_envelopes;
        DROP TABLE event_fills;
        DROP TABLE event_baselines;
        DROP TABLE event_dedup;
        DROP TABLE events;
        DROP TABLE event_cursors;
        """);
}

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
            retention_floor bigint NOT NULL DEFAULT 0 CHECK(retention_floor >= 0 AND retention_floor <= sequence),
            epoch uuid NOT NULL DEFAULT gen_random_uuid()
        );
        CREATE TABLE events (
            owner_id uuid NOT NULL, sequence bigint NOT NULL CHECK(sequence > 0), event_id uuid NOT NULL,
            type varchar(80) NOT NULL, account_id uuid NULL, detected_at timestamptz NOT NULL,
            expires_at timestamptz NULL, payload jsonb NOT NULL,
            PRIMARY KEY(owner_id, sequence), UNIQUE(owner_id, event_id)
        );
        CREATE INDEX ix_events_account ON events(owner_id, account_id) WHERE account_id IS NOT NULL;
        CREATE TABLE event_dedup (
            owner_id uuid NOT NULL, dedup_key varchar(1024) NOT NULL, event_id uuid NOT NULL, account_id uuid NULL,
            PRIMARY KEY(owner_id, dedup_key)
        );
        CREATE INDEX ix_event_dedup_identity ON event_dedup(owner_id, event_id);
        CREATE INDEX ix_event_dedup_account ON event_dedup(owner_id, account_id) WHERE account_id IS NOT NULL;
        CREATE TABLE event_baselines (
            owner_id uuid NOT NULL, account_id uuid NOT NULL, started_at timestamptz NOT NULL,
            PRIMARY KEY(owner_id, account_id)
        );
        CREATE TABLE event_fills (
            owner_id uuid NOT NULL, account_id uuid NOT NULL, contract_id varchar(128) NOT NULL,
            source_fill_id varchar(256) NOT NULL,
            PRIMARY KEY(owner_id, account_id, contract_id, source_fill_id)
        );
        CREATE TABLE event_subscriptions (
            owner_id uuid NOT NULL, name varchar(48) NOT NULL, module varchar(48) NOT NULL,
            filters text[] NOT NULL, filter_fingerprint char(64) NOT NULL,
            responsible_from bigint NOT NULL CHECK(responsible_from >= 0),
            low_water_mark bigint NOT NULL, CHECK(low_water_mark >= responsible_from),
            status varchar(16) NOT NULL CHECK(status IN ('active','lagging')),
            gap_from bigint NULL, gap_to bigint NULL,
            registered_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
            PRIMARY KEY(owner_id, name)
        );
        CREATE TABLE event_receipts (
            owner_id uuid NOT NULL, subscription varchar(48) NOT NULL, event_id uuid NOT NULL, sequence bigint NOT NULL,
            state varchar(16) NOT NULL CHECK(state IN ('pending','delivered','skipped','expired','failed')),
            attempts integer NOT NULL CHECK(attempts >= 0), max_attempts integer NOT NULL CHECK(max_attempts >= 1),
            next_attempt_at timestamptz NOT NULL, error varchar(200) NULL,
            created_at timestamptz NOT NULL, settled_at timestamptz NULL,
            PRIMARY KEY(owner_id, subscription, event_id),
            FOREIGN KEY(owner_id, subscription) REFERENCES event_subscriptions(owner_id, name) ON DELETE CASCADE,
            FOREIGN KEY(owner_id, event_id) REFERENCES events(owner_id, event_id) ON DELETE CASCADE
        );
        CREATE INDEX ix_event_receipts_event ON event_receipts(owner_id, event_id);
        CREATE INDEX ix_event_receipts_due ON event_receipts(owner_id, subscription, next_attempt_at) WHERE state='pending';
        CREATE INDEX ix_event_receipts_pending ON event_receipts(owner_id, sequence) WHERE state='pending';
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DROP TABLE event_receipts;
        DROP TABLE event_subscriptions;
        DROP TABLE event_fills;
        DROP TABLE event_baselines;
        DROP TABLE event_dedup;
        DROP TABLE events;
        DROP TABLE event_cursors;
        """);
}

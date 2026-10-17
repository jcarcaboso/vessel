using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Vessel.Persistence.Migrations;

// Notification storage, like event storage, uses explicit owner predicates and the current EF transaction, not
// EF-tracked entities. No table references accounts or Plays: a foreign-key check would take a key-share lock on the
// account row, which could deadlock the hub (holding a receipt) with account deletion (deleting receipts).
[DbContext(typeof(VesselDbContext))]
[Migration("20261017180000_NotificationHub")]
public sealed class NotificationHub : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        CREATE TABLE notification_cursors (
            owner_id uuid PRIMARY KEY,
            sequence bigint NOT NULL DEFAULT 0 CHECK(sequence >= 0),
            unread_count integer NOT NULL DEFAULT 0 CHECK(unread_count >= 0),
            reset_version bigint NOT NULL DEFAULT 0 CHECK(reset_version >= 0),
            last_test_at timestamptz NULL
        );
        CREATE TABLE notification_preferences (
            owner_id uuid NOT NULL, channel varchar(32) NOT NULL, enabled boolean NOT NULL,
            minimum_severity varchar(16) NOT NULL CHECK(minimum_severity IN ('info','warning','critical')),
            categories text[] NOT NULL, revision bigint NOT NULL CHECK(revision >= 1), updated_at timestamptz NOT NULL,
            PRIMARY KEY(owner_id, channel)
        );
        CREATE TABLE notifications (
            owner_id uuid NOT NULL, notification_id uuid NOT NULL,
            created_sequence bigint NOT NULL CHECK(created_sequence > 0),
            account_id uuid NULL, play_id uuid NULL, run_id uuid NULL,
            kind varchar(16) NOT NULL CHECK(kind IN ('run','discrepancy','monitor','credential','test')),
            category varchar(32) NOT NULL, severity varchar(16) NOT NULL CHECK(severity IN ('info','warning','critical')),
            content jsonb NOT NULL, occurred_at timestamptz NOT NULL, detected_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL,
            PRIMARY KEY(owner_id, notification_id), UNIQUE(owner_id, created_sequence)
        );
        CREATE INDEX ix_notifications_account ON notifications(owner_id, account_id) WHERE account_id IS NOT NULL;
        CREATE INDEX ix_notifications_created ON notifications(owner_id, created_at);
        CREATE TABLE notification_sources (
            owner_id uuid NOT NULL, event_id uuid NOT NULL, notification_id uuid NULL,
            event_type varchar(80) NOT NULL, account_id uuid NULL, subject varchar(80) NULL,
            generation bigint NULL, revision varchar(128) NULL, transition varchar(32) NULL,
            handled_at timestamptz NOT NULL,
            PRIMARY KEY(owner_id, event_id),
            FOREIGN KEY(owner_id, notification_id) REFERENCES notifications(owner_id, notification_id) ON DELETE CASCADE,
            CHECK((subject IS NULL) = (generation IS NULL))
        );
        CREATE INDEX ix_notification_sources_subject ON notification_sources(owner_id, subject, generation) WHERE subject IS NOT NULL;
        CREATE INDEX ix_notification_sources_notification ON notification_sources(owner_id, notification_id) WHERE notification_id IS NOT NULL;
        CREATE INDEX ix_notification_sources_account ON notification_sources(owner_id, account_id) WHERE account_id IS NOT NULL;
        CREATE INDEX ix_notification_sources_handled ON notification_sources(owner_id, handled_at);
        CREATE TABLE notification_deliveries (
            owner_id uuid NOT NULL, notification_id uuid NOT NULL, channel varchar(32) NOT NULL,
            state varchar(16) NOT NULL CHECK(state IN ('unread','read','withdrawn')),
            shown_at timestamptz NULL, read_at timestamptz NULL, state_at timestamptz NOT NULL,
            feed_sequence bigint NULL CHECK(channel <> 'in-app' OR feed_sequence IS NOT NULL),
            PRIMARY KEY(owner_id, notification_id, channel),
            FOREIGN KEY(owner_id, notification_id) REFERENCES notifications(owner_id, notification_id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX ix_notification_deliveries_feed ON notification_deliveries(owner_id, channel, feed_sequence)
            WHERE feed_sequence IS NOT NULL;
        CREATE INDEX ix_notification_deliveries_unread ON notification_deliveries(owner_id, channel) WHERE state = 'unread';
        CREATE TABLE notification_heartbeats (
            owner_id uuid PRIMARY KEY, worker_id varchar(64) NOT NULL, heartbeat_at timestamptz NOT NULL
        );
        -- Run grouping reads a run's events; the run identity lives in the payload.
        CREATE INDEX ix_events_run ON events(owner_id, (payload->>'runId'));
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DROP INDEX ix_events_run;
        DROP TABLE notification_heartbeats;
        DROP TABLE notification_deliveries;
        DROP TABLE notification_sources;
        DROP TABLE notifications;
        DROP TABLE notification_preferences;
        DROP TABLE notification_cursors;
        """);
}

using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Vessel.Persistence.Migrations;

[DbContext(typeof(VesselDbContext))]
[Migration("20261017120000_ServerEventSubscriptions")]
public sealed class ServerEventSubscriptions : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DO $$
        BEGIN
            IF EXISTS(SELECT name FROM event_subscriptions GROUP BY name
                      HAVING count(DISTINCT filter_fingerprint)>1 OR count(DISTINCT module)>1) THEN
                RAISE EXCEPTION 'Subscription registrations have conflicting modules or filter fingerprints.';
            END IF;
        END $$;
        CREATE TABLE event_subscription_registrations (
            name varchar(48) PRIMARY KEY, module varchar(48) NOT NULL, filters text[] NOT NULL,
            filter_fingerprint char(64) NOT NULL, registered_at timestamptz NOT NULL
        );
        INSERT INTO event_subscription_registrations(name,module,filters,filter_fingerprint,registered_at)
        SELECT DISTINCT ON(name) name,module,filters,filter_fingerprint,registered_at
        FROM event_subscriptions ORDER BY name,registered_at,owner_id;
        ALTER TABLE event_subscriptions ADD CONSTRAINT fk_event_subscription_registration
            FOREIGN KEY(name) REFERENCES event_subscription_registrations(name) ON DELETE CASCADE;
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        ALTER TABLE event_subscriptions DROP CONSTRAINT fk_event_subscription_registration;
        DROP TABLE event_subscription_registrations;
        """);
}

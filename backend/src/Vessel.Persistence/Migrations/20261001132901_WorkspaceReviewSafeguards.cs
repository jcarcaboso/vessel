using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class WorkspaceReviewSafeguards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Stop before normalization/index creation if legacy identities collide.
            // The table lock also prevents an API write between the check and index.
            migrationBuilder.Sql("""
                LOCK TABLE accounts IN ACCESS EXCLUSIVE MODE;
                DO $vessel$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM accounts WHERE "Address" IS NOT NULL
                        GROUP BY "OwnerId", "VenueId", lower("Address") HAVING count(*) > 1
                    ) THEN
                        RAISE EXCEPTION USING ERRCODE = 'P0001',
                            MESSAGE = 'Duplicate venue account identities exist. Resolve them explicitly before migrating; no accounts or history were changed.';
                    END IF;
                END
                $vessel$;
                UPDATE accounts SET "Address" = lower("Address") WHERE "Address" IS NOT NULL;
                """);
            migrationBuilder.AddColumn<long>(
                name: "SettingsRevision",
                table: "accounts",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.CreateIndex(
                name: "UX_accounts_owner_venue_address",
                table: "accounts",
                columns: new[] { "OwnerId", "VenueId", "Address" },
                unique: true,
                filter: "\"Address\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_accounts_normalized_address",
                table: "accounts",
                sql: "\"Address\" IS NULL OR \"Address\" = lower(\"Address\")");

            migrationBuilder.AddCheckConstraint(
                name: "CK_accounts_settings_revision",
                table: "accounts",
                sql: "\"SettingsRevision\" >= 1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_accounts_owner_venue_address",
                table: "accounts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_accounts_normalized_address",
                table: "accounts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_accounts_settings_revision",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "SettingsRevision",
                table: "accounts");
        }
    }
}

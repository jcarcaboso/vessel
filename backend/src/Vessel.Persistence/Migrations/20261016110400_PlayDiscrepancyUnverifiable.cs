using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlayDiscrepancyUnverifiable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "PublishedRevision",
                table: "play_discrepancies",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PublishedTransition",
                table: "play_discrepancies",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UnverifiableAtUtc",
                table: "play_discrepancies",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_discrepancy_published",
                table: "play_discrepancies",
                sql: "\"PublishedTransition\" IS NULL OR \"PublishedTransition\" IN ('opened','resolved','dismissed','unverifiable')");

            // Confirmed records were announced; their last transition follows from the state.
            migrationBuilder.Sql("""
                UPDATE play_discrepancies SET "PublishedRevision" = "Revision", "PublishedTransition" =
                    CASE "State" WHEN 'open' THEN 'opened' WHEN 'resolved' THEN 'resolved' WHEN 'dismissed' THEN 'dismissed' END
                WHERE "ConfirmedAtUtc" IS NOT NULL AND "State" <> 'candidate';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_discrepancy_published",
                table: "play_discrepancies");

            migrationBuilder.DropColumn(
                name: "PublishedRevision",
                table: "play_discrepancies");

            migrationBuilder.DropColumn(
                name: "PublishedTransition",
                table: "play_discrepancies");

            migrationBuilder.DropColumn(
                name: "UnverifiableAtUtc",
                table: "play_discrepancies");
        }
    }
}

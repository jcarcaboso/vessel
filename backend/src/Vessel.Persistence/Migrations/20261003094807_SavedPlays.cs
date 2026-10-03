using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SavedPlays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "ContractId",
                table: "plays",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128);

            migrationBuilder.AddColumn<string>(
                name: "CancelReason",
                table: "plays",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CreatedAtUtc",
                table: "plays",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<string>(
                name: "Drawings",
                table: "plays",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "EndedAtUtc",
                table: "plays",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InstrumentSource",
                table: "plays",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Venue");

            migrationBuilder.AddColumn<string>(
                name: "Plan",
                table: "plays",
                type: "jsonb",
                nullable: false,
                defaultValue: @"{""direction"":""long"",""sizingMode"":""margin"",""size"":"""",""leverage"":""1"",""budgetOverride"":null,""entries"":[{""id"":""entry-1"",""name"":""Entry 1"",""color"":""#b9c9e4"",""share"":""100"",""price"":"""",""stop"":{""id"":""stop-1"",""unit"":""price"",""value"":""""},""targets"":[]}],""notes"":{""thesis"":"""",""invalidation"":"""",""strategy"":"""",""evidence"":""""}}");

            migrationBuilder.AddColumn<int>(
                name: "PlanRevision",
                table: "plays",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PlannedAtUtc",
                table: "plays",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Review",
                table: "plays",
                type: "character varying(20000)",
                maxLength: 20000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Title",
                table: "plays",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UpdatedAtUtc",
                table: "plays",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "plays",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            // Play heads before saved Plays had no plan; keep them as planned or closed with a blank one.
            migrationBuilder.Sql("""
                UPDATE plays SET "Status" = 'Planned' WHERE "Status" = 'Active';
                UPDATE plays SET "InstrumentSource" = 'Manual' WHERE "VenueId" = 'manual';
                UPDATE plays SET "CreatedAtUtc" = now(), "UpdatedAtUtc" = now();
                """);

            migrationBuilder.CreateTable(
                name: "play_plan_revisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Plan = table.Column<string>(type: "jsonb", nullable: false),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_play_plan_revisions", x => x.Id);
                    table.CheckConstraint("CK_play_plan_revisions_number", "\"Number\" >= 1");
                    table.ForeignKey(
                        name: "FK_play_plan_revisions_plays_OwnerId_PlayId",
                        columns: x => new { x.OwnerId, x.PlayId },
                        principalTable: "plays",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "play_status_changes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: false),
                    From = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    To = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Reason = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_play_status_changes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_play_status_changes_plays_OwnerId_PlayId",
                        columns: x => new { x.OwnerId, x.PlayId },
                        principalTable: "plays",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_plays_OwnerId_UpdatedAtUtc",
                table: "plays",
                columns: new[] { "OwnerId", "UpdatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_play_plan_revisions_OwnerId_PlayId_Number",
                table: "play_plan_revisions",
                columns: new[] { "OwnerId", "PlayId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_play_status_changes_OwnerId_PlayId_OccurredAtUtc",
                table: "play_status_changes",
                columns: new[] { "OwnerId", "PlayId", "OccurredAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "play_plan_revisions");

            migrationBuilder.DropTable(
                name: "play_status_changes");

            migrationBuilder.Sql("""
                DELETE FROM plays WHERE "ContractId" IS NULL;
                UPDATE plays SET "Status" = CASE WHEN "Status" IN ('Closed', 'Cancelled') THEN 'Closed' ELSE 'Active' END;
                """);

            migrationBuilder.DropIndex(
                name: "IX_plays_OwnerId_UpdatedAtUtc",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "CancelReason",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "CreatedAtUtc",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "Drawings",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "EndedAtUtc",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "InstrumentSource",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "Plan",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "PlanRevision",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "PlannedAtUtc",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "Review",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "Title",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "UpdatedAtUtc",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "plays");

            migrationBuilder.AlterColumn<string>(
                name: "ContractId",
                table: "plays",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128,
                oldNullable: true);
        }
    }
}

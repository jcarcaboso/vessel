using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DiaryCompletion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Origin",
                table: "plays",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Planned");

            migrationBuilder.AddColumn<string>(
                name: "ReviewAdherence",
                table: "plays",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewLesson",
                table: "plays",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ReviewMistakeTag",
                table: "plays",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewNextAction",
                table: "plays",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "ReviewRevision",
                table: "plays",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ReviewedAtUtc",
                table: "plays",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "diary_requests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PayloadHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Response = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_diary_requests", x => new { x.OwnerId, x.Id });
                });

            migrationBuilder.CreateTable(
                name: "manual_execution_history",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExecutionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Before = table.Column<string>(type: "jsonb", nullable: true),
                    After = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_manual_execution_history", x => x.Id);
                    table.ForeignKey(
                        name: "FK_manual_execution_history_plays_OwnerId_PlayId",
                        columns: x => new { x.OwnerId, x.PlayId },
                        principalTable: "plays",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "manual_executions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EntryId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Side = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Quantity = table.Column<string>(type: "character varying(96)", maxLength: 96, nullable: false),
                    Price = table.Column<string>(type: "character varying(96)", maxLength: 96, nullable: false),
                    Fee = table.Column<string>(type: "character varying(96)", maxLength: 96, nullable: true),
                    FeeCurrency = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    Source = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_manual_executions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_manual_executions_plays_OwnerId_PlayId",
                        columns: x => new { x.OwnerId, x.PlayId },
                        principalTable: "plays",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "play_review_revisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Review = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    StructuredReview = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_play_review_revisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_play_review_revisions_plays_OwnerId_PlayId",
                        columns: x => new { x.OwnerId, x.PlayId },
                        principalTable: "plays",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_manual_execution_history_OwnerId_PlayId_OccurredAtUtc",
                table: "manual_execution_history",
                columns: new[] { "OwnerId", "PlayId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_manual_executions_OwnerId_PlayId_OccurredAtUtc",
                table: "manual_executions",
                columns: new[] { "OwnerId", "PlayId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_play_review_revisions_OwnerId_PlayId_Number",
                table: "play_review_revisions",
                columns: new[] { "OwnerId", "PlayId", "Number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "diary_requests");

            migrationBuilder.DropTable(
                name: "manual_execution_history");

            migrationBuilder.DropTable(
                name: "manual_executions");

            migrationBuilder.DropTable(
                name: "play_review_revisions");

            migrationBuilder.DropColumn(
                name: "Origin",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "ReviewAdherence",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "ReviewLesson",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "ReviewMistakeTag",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "ReviewNextAction",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "ReviewRevision",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "ReviewedAtUtc",
                table: "plays");
        }
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AccountMonitor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "monitor_accounts",
                columns: table => new
                {
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    State = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IntervalSeconds = table.Column<int>(type: "integer", nullable: false),
                    NextRunAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RequestId = table.Column<Guid>(type: "uuid", nullable: true),
                    Trigger = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ManualState = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    NextManualAllowedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LeaseHolder = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    LeaseUntilUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Generation = table.Column<long>(type: "bigint", nullable: false),
                    LastAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastSuccessAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastObservationAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastOrdersObservationAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    NewestFillAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ConsecutiveFailures = table.Column<int>(type: "integer", nullable: false),
                    HasHistoryGap = table.Column<bool>(type: "boolean", nullable: false),
                    Error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CredentialRevision = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ConfirmationAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_monitor_accounts", x => x.AccountId);
                    table.CheckConstraint("CK_monitor_generation", "\"Generation\" >= 0");
                    table.CheckConstraint("CK_monitor_interval", "\"IntervalSeconds\" BETWEEN 60 AND 3600");
                    table.CheckConstraint("CK_monitor_manual_state", "\"ManualState\" IN ('idle','pending','running')");
                    table.ForeignKey(
                        name: "FK_monitor_accounts_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "monitor_exit_watches",
                columns: table => new
                {
                    LinkId = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    LinkRevisionAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ResolvedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_monitor_exit_watches", x => x.LinkId);
                    table.ForeignKey(
                        name: "FK_monitor_exit_watches_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_monitor_exit_watches_play_order_links_LinkId",
                        column: x => x.LinkId,
                        principalTable: "play_order_links",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "monitor_heartbeats",
                columns: table => new
                {
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkerId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    HeartbeatAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_monitor_heartbeats", x => x.OwnerId);
                });

            migrationBuilder.CreateTable(
                name: "monitor_venue_budgets",
                columns: table => new
                {
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    VenueId = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    RetryAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_monitor_venue_budgets", x => new { x.OwnerId, x.VenueId });
                });

            migrationBuilder.CreateIndex(
                name: "IX_monitor_accounts_OwnerId_AccountId",
                table: "monitor_accounts",
                columns: new[] { "OwnerId", "AccountId" });

            migrationBuilder.CreateIndex(
                name: "IX_monitor_accounts_OwnerId_NextRunAtUtc",
                table: "monitor_accounts",
                columns: new[] { "OwnerId", "NextRunAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_monitor_exit_watches_OwnerId_AccountId_ResolvedAtUtc",
                table: "monitor_exit_watches",
                columns: new[] { "OwnerId", "AccountId", "ResolvedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "monitor_accounts");

            migrationBuilder.DropTable(
                name: "monitor_exit_watches");

            migrationBuilder.DropTable(
                name: "monitor_heartbeats");

            migrationBuilder.DropTable(
                name: "monitor_venue_budgets");
        }
    }
}

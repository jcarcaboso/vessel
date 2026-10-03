using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlayExecution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "play_status_changes",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Owner");

            migrationBuilder.CreateTable(
                name: "imported_orders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    OrderId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Side = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    OrderType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    LimitPrice = table.Column<decimal>(type: "numeric", nullable: false),
                    TriggerPrice = table.Column<decimal>(type: "numeric", nullable: true),
                    ReduceOnly = table.Column<bool>(type: "boolean", nullable: false),
                    IsPositionTpsl = table.Column<bool>(type: "boolean", nullable: false),
                    OriginalSize = table.Column<decimal>(type: "numeric", nullable: false),
                    RemainingSize = table.Column<decimal>(type: "numeric", nullable: false),
                    PlacedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    VenueStatus = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    StatusAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ObservedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_imported_orders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_imported_orders_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "play_order_links",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EntryId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    TargetId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_play_order_links", x => x.Id);
                    table.ForeignKey(
                        name: "FK_play_order_links_plays_OwnerId_PlayId",
                        columns: x => new { x.OwnerId, x.PlayId },
                        principalTable: "plays",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_imported_orders_OwnerId_AccountId_OrderId",
                table: "imported_orders",
                columns: new[] { "OwnerId", "AccountId", "OrderId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_play_order_links_OwnerId_PlayId",
                table: "play_order_links",
                columns: new[] { "OwnerId", "PlayId" });

            migrationBuilder.CreateIndex(
                name: "UX_play_order_links_linked_order",
                table: "play_order_links",
                columns: new[] { "OwnerId", "AccountId", "OrderId" },
                unique: true,
                filter: "\"State\" = 'Linked'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "imported_orders");

            migrationBuilder.DropTable(
                name: "play_order_links");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "play_status_changes");
        }
    }
}

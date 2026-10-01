using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CoreAccountPortfolio : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "accounts",
                type: "character varying(42)",
                maxLength: 42,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HistoryNotice",
                table: "accounts",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastSyncError",
                table: "accounts",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastSyncedAtUtc",
                table: "accounts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ManualAccountValueUsd",
                table: "accounts",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PortfolioId",
                table: "accounts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SyncStatus",
                table: "accounts",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "not-synced");

            // Foundation accounts remain unassigned with unknown balances.
            migrationBuilder.Sql("UPDATE accounts SET \"SyncStatus\" = 'manual' WHERE \"VenueId\" = 'manual'");

            migrationBuilder.CreateTable(
                name: "account_snapshots",
                columns: table => new
                {
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ObservedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ValueScope = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AccountValueUsd = table.Column<decimal>(type: "numeric", nullable: true),
                    WithdrawableUsd = table.Column<decimal>(type: "numeric", nullable: true),
                    MarginUsedUsd = table.Column<decimal>(type: "numeric", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_snapshots", x => new { x.OwnerId, x.AccountId });
                    table.ForeignKey(
                        name: "FK_account_snapshots_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "imported_fills",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SourceFillId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Side = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Direction = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Price = table.Column<decimal>(type: "numeric", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric", nullable: false),
                    Fee = table.Column<decimal>(type: "numeric", nullable: false),
                    FeeToken = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ClosedPnlUsd = table.Column<decimal>(type: "numeric", nullable: false),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    OrderId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TransactionHash = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_imported_fills", x => x.Id);
                    table.ForeignKey(
                        name: "FK_imported_fills_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "portfolios",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_portfolios", x => x.Id);
                    table.UniqueConstraint("AK_portfolios_OwnerId_Id", x => new { x.OwnerId, x.Id });
                });

            migrationBuilder.CreateTable(
                name: "account_positions",
                columns: table => new
                {
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SignedQuantity = table.Column<decimal>(type: "numeric", nullable: false),
                    EntryPrice = table.Column<decimal>(type: "numeric", nullable: false),
                    UnrealizedPnlUsd = table.Column<decimal>(type: "numeric", nullable: false),
                    MarginUsedUsd = table.Column<decimal>(type: "numeric", nullable: false),
                    Leverage = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_positions", x => new { x.OwnerId, x.AccountId, x.ContractId });
                    table.ForeignKey(
                        name: "FK_account_positions_account_snapshots_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "account_snapshots",
                        principalColumns: new[] { "OwnerId", "AccountId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_accounts_OwnerId_PortfolioId",
                table: "accounts",
                columns: new[] { "OwnerId", "PortfolioId" });

            migrationBuilder.CreateIndex(
                name: "IX_imported_fills_OwnerId_AccountId_ContractId_SourceFillId",
                table: "imported_fills",
                columns: new[] { "OwnerId", "AccountId", "ContractId", "SourceFillId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_imported_fills_OwnerId_OccurredAtUtc",
                table: "imported_fills",
                columns: new[] { "OwnerId", "OccurredAtUtc" });

            migrationBuilder.AddForeignKey(
                name: "FK_accounts_portfolios_OwnerId_PortfolioId",
                table: "accounts",
                columns: new[] { "OwnerId", "PortfolioId" },
                principalTable: "portfolios",
                principalColumns: new[] { "OwnerId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_accounts_portfolios_OwnerId_PortfolioId",
                table: "accounts");

            migrationBuilder.DropTable(
                name: "account_positions");

            migrationBuilder.DropTable(
                name: "imported_fills");

            migrationBuilder.DropTable(
                name: "portfolios");

            migrationBuilder.DropTable(
                name: "account_snapshots");

            migrationBuilder.DropIndex(
                name: "IX_accounts_OwnerId_PortfolioId",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "Address",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "HistoryNotice",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "LastSyncError",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "LastSyncedAtUtc",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "ManualAccountValueUsd",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "PortfolioId",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "SyncStatus",
                table: "accounts");
        }
    }
}

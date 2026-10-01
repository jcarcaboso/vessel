using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class StablecoinWallet : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AccountMode",
                table: "account_snapshots",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StablecoinScope",
                table: "account_snapshots",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "StablecoinsObservedAtUtc",
                table: "account_snapshots",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "account_stablecoins",
                columns: table => new
                {
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TokenIndex = table.Column<int>(type: "integer", nullable: false),
                    Symbol = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Total = table.Column<decimal>(type: "numeric", nullable: false),
                    Held = table.Column<decimal>(type: "numeric", nullable: false),
                    Available = table.Column<decimal>(type: "numeric", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_stablecoins", x => new { x.OwnerId, x.AccountId, x.TokenId });
                    table.ForeignKey(
                        name: "FK_account_stablecoins_account_snapshots_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "account_snapshots",
                        principalColumns: new[] { "OwnerId", "AccountId" },
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "account_stablecoins");

            migrationBuilder.DropColumn(
                name: "AccountMode",
                table: "account_snapshots");

            migrationBuilder.DropColumn(
                name: "StablecoinScope",
                table: "account_snapshots");

            migrationBuilder.DropColumn(
                name: "StablecoinsObservedAtUtc",
                table: "account_snapshots");
        }
    }
}

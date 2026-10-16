using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FundingPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "account_funding_states",
                columns: table => new
                {
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    CoveredFromUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CoveredToUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastAttemptFromUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastAttemptToUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastReadComplete = table.Column<bool>(type: "boolean", nullable: false),
                    PnlBasis = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Notice = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_funding_states", x => new { x.OwnerId, x.AccountId });
                    table.CheckConstraint("CK_account_funding_states_basis", "\"PnlBasis\" IN ('excluded', 'included', 'unknown')");
                    table.CheckConstraint("CK_account_funding_states_window", "(\"CoveredFromUtc\" IS NULL AND \"CoveredToUtc\" IS NULL OR \"CoveredFromUtc\" IS NOT NULL AND \"CoveredToUtc\" IS NOT NULL AND \"CoveredFromUtc\" <= \"CoveredToUtc\") AND \"LastAttemptFromUtc\" <= \"LastAttemptToUtc\" ");
                    table.ForeignKey(
                        name: "FK_account_funding_states_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "funding_payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ContractId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    VenueContractId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Amount = table.Column<decimal>(type: "numeric", nullable: false),
                    Asset = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OccurredAtUnixNanoseconds = table.Column<long>(type: "bigint", nullable: true),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_funding_payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_funding_payments_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_funding_payments_OwnerId_AccountId_OccurredAtUtc",
                table: "funding_payments",
                columns: new[] { "OwnerId", "AccountId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_funding_payments_OwnerId_AccountId_SourceId",
                table: "funding_payments",
                columns: new[] { "OwnerId", "AccountId", "SourceId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "account_funding_states");

            migrationBuilder.DropTable(
                name: "funding_payments");
        }
    }
}

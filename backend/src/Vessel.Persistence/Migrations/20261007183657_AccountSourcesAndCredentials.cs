using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AccountSourcesAndCredentials : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_accounts_owner_venue_address",
                table: "accounts");

            migrationBuilder.AddColumn<string>(
                name: "SourceId",
                table: "accounts",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VenueContractId",
                table: "account_positions",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            // Existing address-based accounts keep their identity, including disabled accounts.
            migrationBuilder.Sql("""UPDATE accounts SET "SourceId" = "Address" WHERE "Address" IS NOT NULL;""");
            migrationBuilder.Sql("""UPDATE account_positions SET "VenueContractId" = "ContractId";""");

            migrationBuilder.CreateTable(
                name: "account_credentials",
                columns: table => new
                {
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Purpose = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    KeyId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Nonce = table.Column<byte[]>(type: "bytea", nullable: false),
                    Ciphertext = table.Column<byte[]>(type: "bytea", nullable: false),
                    Tag = table.Column<byte[]>(type: "bytea", nullable: false),
                    Scope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastVerifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastError = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_credentials", x => new { x.OwnerId, x.AccountId, x.Purpose });
                    table.CheckConstraint("CK_account_credentials_envelope", "octet_length(\"Nonce\") = 12 AND octet_length(\"Tag\") = 16 AND octet_length(\"Ciphertext\") BETWEEN 1 AND 2048");
                    table.CheckConstraint("CK_account_credentials_scope", "\"Scope\" IN ('single', 'all')");
                    table.ForeignKey(
                        name: "FK_account_credentials_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_accounts_owner_venue_source",
                table: "accounts",
                columns: new[] { "OwnerId", "VenueId", "SourceId" },
                unique: true,
                filter: "\"SourceId\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_accounts_source_identity",
                table: "accounts",
                sql: "(\"Address\" IS NULL OR \"SourceId\" IS NOT NULL AND \"SourceId\" = \"Address\") AND CASE WHEN \"SourceId\" IS NULL OR \"Address\" IS NOT NULL THEN true WHEN \"SourceId\" ~ '^(0|[1-9][0-9]{0,18})$' THEN \"SourceId\"::numeric <= 9223372036854775807 ELSE false END");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "account_credentials");

            migrationBuilder.DropIndex(
                name: "UX_accounts_owner_venue_source",
                table: "accounts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_accounts_source_identity",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "SourceId",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "VenueContractId",
                table: "account_positions");

            migrationBuilder.CreateIndex(
                name: "UX_accounts_owner_venue_address",
                table: "accounts",
                columns: new[] { "OwnerId", "VenueId", "Address" },
                unique: true,
                filter: "\"Address\" IS NOT NULL");
        }
    }
}

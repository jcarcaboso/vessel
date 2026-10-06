using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NormalizedExecutionFacts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FeeBasis",
                table: "imported_fills",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "reported");

            migrationBuilder.AddColumn<string>(
                name: "PnlBasis",
                table: "imported_fills",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "gross");

            migrationBuilder.AddColumn<string>(
                name: "PositionEffect",
                table: "imported_fills",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "unknown");

            // Rows imported so far are Hyperliquid facts in its own encoding: B (bid) buys, A (ask) sells,
            // and the direction text says whether a fill opened, closed or flipped the position.
            migrationBuilder.Sql("""
                UPDATE imported_fills SET "Side" = CASE "Side" WHEN 'B' THEN 'buy' WHEN 'A' THEN 'sell' ELSE "Side" END;
                UPDATE imported_fills SET "PositionEffect" = CASE
                    WHEN "Direction" IN ('Open Long', 'Open Short') THEN 'open'
                    WHEN "Direction" IN ('Close Long', 'Close Short') THEN 'close'
                    WHEN "Direction" IN ('Long > Short', 'Short > Long') THEN 'flip'
                    ELSE 'unknown' END;
                UPDATE imported_orders SET "Side" = CASE "Side" WHEN 'B' THEN 'buy' WHEN 'A' THEN 'sell' ELSE "Side" END;
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_imported_orders_side",
                table: "imported_orders",
                sql: "\"Side\" IN ('buy', 'sell')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_imported_fills_fee_basis",
                table: "imported_fills",
                sql: "\"FeeBasis\" IN ('reported', 'standard-account-free')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_imported_fills_pnl_basis",
                table: "imported_fills",
                sql: "\"PnlBasis\" IN ('gross', 'net-of-fee')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_imported_fills_position_effect",
                table: "imported_fills",
                sql: "\"PositionEffect\" IN ('open', 'close', 'flip', 'unknown')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_imported_fills_side",
                table: "imported_fills",
                sql: "\"Side\" IN ('buy', 'sell')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_imported_orders_side",
                table: "imported_orders");

            migrationBuilder.DropCheckConstraint(
                name: "CK_imported_fills_fee_basis",
                table: "imported_fills");

            migrationBuilder.DropCheckConstraint(
                name: "CK_imported_fills_pnl_basis",
                table: "imported_fills");

            migrationBuilder.DropCheckConstraint(
                name: "CK_imported_fills_position_effect",
                table: "imported_fills");

            migrationBuilder.DropCheckConstraint(
                name: "CK_imported_fills_side",
                table: "imported_fills");

            migrationBuilder.Sql("""
                UPDATE imported_fills SET "Side" = CASE "Side" WHEN 'buy' THEN 'B' WHEN 'sell' THEN 'A' ELSE "Side" END;
                UPDATE imported_orders SET "Side" = CASE "Side" WHEN 'buy' THEN 'B' WHEN 'sell' THEN 'A' ELSE "Side" END;
                """);

            migrationBuilder.DropColumn(
                name: "FeeBasis",
                table: "imported_fills");

            migrationBuilder.DropColumn(
                name: "PnlBasis",
                table: "imported_fills");

            migrationBuilder.DropColumn(
                name: "PositionEffect",
                table: "imported_fills");
        }
    }
}

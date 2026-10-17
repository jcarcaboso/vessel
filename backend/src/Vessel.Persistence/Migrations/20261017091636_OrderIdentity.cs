using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OrderIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Breaking change with no backfill (docs/architecture/order-identity.md): refuse a database that holds
            // order facts or links instead of silently truncating or mislinking them. The lock keeps writers out
            // between the check and the schema change.
            migrationBuilder.Sql("""
                LOCK TABLE imported_orders, imported_fills, play_order_links IN ACCESS EXCLUSIVE MODE;
                DO $vessel$
                BEGIN
                    IF EXISTS (SELECT 1 FROM imported_orders) OR EXISTS (SELECT 1 FROM imported_fills)
                        OR EXISTS (SELECT 1 FROM play_order_links) THEN
                        RAISE EXCEPTION USING ERRCODE = 'P0001',
                            MESSAGE = 'Order identity changed without a data backfill. Imported orders, fills or order links exist; recreate the database before migrating. No data was changed.';
                    END IF;
                END
                $vessel$;
                """);

            migrationBuilder.DropIndex(
                name: "UX_play_order_links_linked_order",
                table: "play_order_links");

            migrationBuilder.DropIndex(
                name: "IX_imported_orders_OwnerId_AccountId_OrderId",
                table: "imported_orders");

            migrationBuilder.DropColumn(
                name: "OrderId",
                table: "play_order_links");

            migrationBuilder.DropColumn(
                name: "OrderId",
                table: "monitor_exit_watches");

            migrationBuilder.RenameColumn(
                name: "OrderId",
                table: "imported_orders",
                newName: "ExternalOrderId");

            migrationBuilder.RenameColumn(
                name: "OrderId",
                table: "imported_fills",
                newName: "ExternalOrderId");

            migrationBuilder.AddColumn<Guid>(
                name: "ImportedOrderId",
                table: "play_order_links",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddUniqueConstraint(
                name: "AK_imported_orders_OwnerId_AccountId_Id",
                table: "imported_orders",
                columns: new[] { "OwnerId", "AccountId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_play_order_links_OwnerId_AccountId_ImportedOrderId",
                table: "play_order_links",
                columns: new[] { "OwnerId", "AccountId", "ImportedOrderId" });

            migrationBuilder.CreateIndex(
                name: "UX_play_order_links_linked_order",
                table: "play_order_links",
                columns: new[] { "OwnerId", "ImportedOrderId" },
                unique: true,
                filter: "\"State\" = 'Linked'");

            migrationBuilder.CreateIndex(
                name: "IX_imported_orders_OwnerId_AccountId_ContractId_ExternalOrderId",
                table: "imported_orders",
                columns: new[] { "OwnerId", "AccountId", "ContractId", "ExternalOrderId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_imported_fills_OwnerId_AccountId_ContractId_ExternalOrderId",
                table: "imported_fills",
                columns: new[] { "OwnerId", "AccountId", "ContractId", "ExternalOrderId" });

            migrationBuilder.AddForeignKey(
                name: "FK_play_order_links_imported_orders_OwnerId_AccountId_Imported~",
                table: "play_order_links",
                columns: new[] { "OwnerId", "AccountId", "ImportedOrderId" },
                principalTable: "imported_orders",
                principalColumns: new[] { "OwnerId", "AccountId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reversing has no backfill either: links would lose their order. Refuse unless the tables are empty.
            migrationBuilder.Sql("""
                LOCK TABLE imported_orders, imported_fills, play_order_links IN ACCESS EXCLUSIVE MODE;
                DO $vessel$
                BEGIN
                    IF EXISTS (SELECT 1 FROM imported_orders) OR EXISTS (SELECT 1 FROM imported_fills)
                        OR EXISTS (SELECT 1 FROM play_order_links) THEN
                        RAISE EXCEPTION USING ERRCODE = 'P0001',
                            MESSAGE = 'Order identity changed without a data backfill. Imported orders, fills or order links exist; recreate the database before migrating. No data was changed.';
                    END IF;
                END
                $vessel$;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_play_order_links_imported_orders_OwnerId_AccountId_Imported~",
                table: "play_order_links");

            migrationBuilder.DropIndex(
                name: "IX_play_order_links_OwnerId_AccountId_ImportedOrderId",
                table: "play_order_links");

            migrationBuilder.DropIndex(
                name: "UX_play_order_links_linked_order",
                table: "play_order_links");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_imported_orders_OwnerId_AccountId_Id",
                table: "imported_orders");

            migrationBuilder.DropIndex(
                name: "IX_imported_orders_OwnerId_AccountId_ContractId_ExternalOrderId",
                table: "imported_orders");

            migrationBuilder.DropIndex(
                name: "IX_imported_fills_OwnerId_AccountId_ContractId_ExternalOrderId",
                table: "imported_fills");

            migrationBuilder.DropColumn(
                name: "ImportedOrderId",
                table: "play_order_links");

            migrationBuilder.RenameColumn(
                name: "ExternalOrderId",
                table: "imported_orders",
                newName: "OrderId");

            migrationBuilder.RenameColumn(
                name: "ExternalOrderId",
                table: "imported_fills",
                newName: "OrderId");

            migrationBuilder.AddColumn<string>(
                name: "OrderId",
                table: "play_order_links",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "OrderId",
                table: "monitor_exit_watches",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "UX_play_order_links_linked_order",
                table: "play_order_links",
                columns: new[] { "OwnerId", "AccountId", "OrderId" },
                unique: true,
                filter: "\"State\" = 'Linked'");

            migrationBuilder.CreateIndex(
                name: "IX_imported_orders_OwnerId_AccountId_OrderId",
                table: "imported_orders",
                columns: new[] { "OwnerId", "AccountId", "OrderId" },
                unique: true);
        }
    }
}

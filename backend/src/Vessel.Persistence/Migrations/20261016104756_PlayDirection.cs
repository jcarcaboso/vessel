using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlayDirection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Lists read the direction without parsing plans. Backfill it from each stored plan, then require it.
            migrationBuilder.AddColumn<string>(
                name: "Direction",
                table: "plays",
                type: "text",
                nullable: true);

            migrationBuilder.Sql("""UPDATE plays SET "Direction" = COALESCE("Plan"->>'direction', '');""");

            migrationBuilder.AlterColumn<string>(
                name: "Direction",
                table: "plays",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_plays_OwnerId_Status_EndedAtUtc_UpdatedAtUtc",
                table: "plays",
                columns: new[] { "OwnerId", "Status", "EndedAtUtc", "UpdatedAtUtc" },
                descending: new[] { false, false, true, true });

            migrationBuilder.CreateIndex(
                name: "IX_plays_OwnerId_Status_UpdatedAtUtc_Id",
                table: "plays",
                columns: new[] { "OwnerId", "Status", "UpdatedAtUtc", "Id" },
                descending: new[] { false, false, true, false });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_plays_OwnerId_Status_EndedAtUtc_UpdatedAtUtc",
                table: "plays");

            migrationBuilder.DropIndex(
                name: "IX_plays_OwnerId_Status_UpdatedAtUtc_Id",
                table: "plays");

            migrationBuilder.DropColumn(
                name: "Direction",
                table: "plays");
        }
    }
}

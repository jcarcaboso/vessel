using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class EvidenceStorage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_plays_OwnerId_Id",
                table: "plays",
                columns: new[] { "OwnerId", "Id" });

            migrationBuilder.CreateTable(
                name: "play_evidence",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    Sha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Note = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_play_evidence", x => x.Id);
                    table.CheckConstraint("CK_play_evidence_sha256", "\"Sha256\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_play_evidence_size", "\"SizeBytes\" > 0");
                    table.ForeignKey(
                        name: "FK_play_evidence_plays_OwnerId_PlayId",
                        columns: x => new { x.OwnerId, x.PlayId },
                        principalTable: "plays",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_play_evidence_ObjectKey",
                table: "play_evidence",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_play_evidence_OwnerId_PlayId_CreatedAtUtc",
                table: "play_evidence",
                columns: new[] { "OwnerId", "PlayId", "CreatedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "play_evidence");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_plays_OwnerId_Id",
                table: "plays");
        }
    }
}

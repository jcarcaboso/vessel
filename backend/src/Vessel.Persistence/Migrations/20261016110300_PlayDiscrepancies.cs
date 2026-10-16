using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlayDiscrepancies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "play_discrepancies",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayId = table.Column<Guid>(type: "uuid", nullable: true),
                    InvolvedPlayIds = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    ContractId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NativeContractId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SubjectKey = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Kind = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Severity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Details = table.Column<string>(type: "jsonb", nullable: false),
                    OpenedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ConfirmedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ResolvedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DismissedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    LastObservedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PendingFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    PendingSinceUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_play_discrepancies", x => x.Id);
                    table.CheckConstraint("CK_discrepancy_severity", "\"Severity\" IN ('info','warning','critical')");
                    table.CheckConstraint("CK_discrepancy_state", "\"State\" IN ('candidate','open','resolved','dismissed')");
                    table.ForeignKey(
                        name: "FK_play_discrepancies_accounts_OwnerId_AccountId",
                        columns: x => new { x.OwnerId, x.AccountId },
                        principalTable: "accounts",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_play_discrepancies_plays_OwnerId_PlayId",
                        columns: x => new { x.OwnerId, x.PlayId },
                        principalTable: "plays",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_play_discrepancies_OwnerId_AccountId_Kind_SubjectKey",
                table: "play_discrepancies",
                columns: new[] { "OwnerId", "AccountId", "Kind", "SubjectKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_play_discrepancies_OwnerId_PlayId",
                table: "play_discrepancies",
                columns: new[] { "OwnerId", "PlayId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "play_discrepancies");
        }
    }
}

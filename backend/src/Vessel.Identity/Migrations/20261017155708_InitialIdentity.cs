using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Identity.Migrations
{
    /// <inheritdoc />
    public partial class InitialIdentity(IdentitySchema schema) : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: schema.Name);

            migrationBuilder.CreateTable(
                name: "auth_challenges",
                schema: schema.Name,
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    purpose = table.Column<string>(type: "text", nullable: false),
                    address = table.Column<string>(type: "character(42)", nullable: false),
                    origin = table.Column<string>(type: "text", nullable: false),
                    message = table.Column<string>(type: "text", nullable: false),
                    binding_hash = table.Column<byte[]>(type: "bytea", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    session_id = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "text", nullable: true),
                    target = table.Column<string>(type: "text", nullable: true),
                    issued_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    consumed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_auth_challenges", x => x.id);
                    table.CheckConstraint("ck_auth_challenges_purpose", "purpose IN ('sign-in', 'link', 'step-up')");
                });

            migrationBuilder.CreateTable(
                name: "invitations",
                schema: schema.Name,
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    code_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    note = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    max_uses = table.Column<int>(type: "integer", nullable: false),
                    uses = table.Column<int>(type: "integer", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_invitations", x => x.id);
                    table.CheckConstraint("ck_invitations_uses", "max_uses > 0 AND uses >= 0 AND uses <= max_uses");
                });

            migrationBuilder.CreateTable(
                name: "pending_registrations",
                schema: schema.Name,
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    address = table.Column<string>(type: "character(42)", nullable: false),
                    origin = table.Column<string>(type: "text", nullable: false),
                    binding_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    consumed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pending_registrations", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                schema: schema.Name,
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    display_name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    role = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    suspended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.id);
                    table.CheckConstraint("ck_users_role", "role IN ('member', 'operator')");
                    table.CheckConstraint("ck_users_status", "status IN ('active', 'suspended')");
                });

            migrationBuilder.CreateTable(
                name: "user_wallets",
                schema: schema.Name,
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    address = table.Column<string>(type: "character(42)", nullable: false),
                    label = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    added_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_wallets", x => x.id);
                    table.ForeignKey(
                        name: "FK_user_wallets_users_user_id",
                        column: x => x.user_id,
                        principalSchema: schema.Name,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "sessions",
                schema: schema.Name,
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    wallet_id = table.Column<Guid>(type: "uuid", nullable: true),
                    token_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    remember = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    idle_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    absolute_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoke_reason = table.Column<string>(type: "text", nullable: true),
                    step_up_action = table.Column<string>(type: "text", nullable: true),
                    step_up_target = table.Column<string>(type: "text", nullable: true),
                    step_up_wallet_id = table.Column<Guid>(type: "uuid", nullable: true),
                    step_up_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    user_agent_summary = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sessions", x => x.id);
                    table.CheckConstraint("ck_sessions_live_wallet", "revoked_at IS NOT NULL OR wallet_id IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_sessions_user_wallets_step_up_wallet_id",
                        column: x => x.step_up_wallet_id,
                        principalSchema: schema.Name,
                        principalTable: "user_wallets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_sessions_user_wallets_wallet_id",
                        column: x => x.wallet_id,
                        principalSchema: schema.Name,
                        principalTable: "user_wallets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_sessions_users_user_id",
                        column: x => x.user_id,
                        principalSchema: schema.Name,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_auth_challenges_expires_at",
                schema: schema.Name,
                table: "auth_challenges",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "IX_invitations_code_hash",
                schema: schema.Name,
                table: "invitations",
                column: "code_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pending_registrations_expires_at",
                schema: schema.Name,
                table: "pending_registrations",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "IX_pending_registrations_token_hash",
                schema: schema.Name,
                table: "pending_registrations",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sessions_step_up_wallet_id",
                schema: schema.Name,
                table: "sessions",
                column: "step_up_wallet_id");

            migrationBuilder.CreateIndex(
                name: "IX_sessions_token_hash",
                schema: schema.Name,
                table: "sessions",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sessions_user_id_created_at",
                schema: schema.Name,
                table: "sessions",
                columns: new[] { "user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_sessions_wallet_id",
                schema: schema.Name,
                table: "sessions",
                column: "wallet_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_wallets_address",
                schema: schema.Name,
                table: "user_wallets",
                column: "address",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_wallets_user_id",
                schema: schema.Name,
                table: "user_wallets",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "auth_challenges",
                schema: schema.Name);

            migrationBuilder.DropTable(
                name: "invitations",
                schema: schema.Name);

            migrationBuilder.DropTable(
                name: "pending_registrations",
                schema: schema.Name);

            migrationBuilder.DropTable(
                name: "sessions",
                schema: schema.Name);

            migrationBuilder.DropTable(
                name: "user_wallets",
                schema: schema.Name);

            migrationBuilder.DropTable(
                name: "users",
                schema: schema.Name);
        }
    }
}

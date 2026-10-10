using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vessel.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MultipleStops : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "TargetId",
                table: "play_order_links",
                newName: "LevelId");

            // Each entry's single stop becomes a one-item stop list that closes the whole entry.
            foreach (var table in PlanTables)
                migrationBuilder.Sql($$"""
                    UPDATE {{table}} SET "Plan" = jsonb_set("Plan", '{entries}', (
                        SELECT jsonb_agg(CASE WHEN e ? 'stop'
                            THEN (e - 'stop') || jsonb_build_object('stops', jsonb_build_array((e -> 'stop') || '{"share":"100"}'::jsonb))
                            ELSE e END ORDER BY n)
                        FROM jsonb_array_elements("Plan" -> 'entries') WITH ORDINALITY AS t(e, n)))
                    WHERE jsonb_typeof("Plan" -> 'entries') = 'array' AND jsonb_array_length("Plan" -> 'entries') > 0;
                    """);

            // Stop links now name their stop, like target links name their target.
            migrationBuilder.Sql("""
                UPDATE play_order_links AS l SET "LevelId" = s.stop_id
                FROM (SELECT p."Id" AS play_id, e ->> 'id' AS entry_id, e -> 'stops' -> 0 ->> 'id' AS stop_id
                      FROM plays AS p, jsonb_array_elements(p."Plan" -> 'entries') AS e) AS s
                WHERE l."Role" = 'Stop' AND l."LevelId" IS NULL AND s.play_id = l."PlayId" AND s.entry_id = l."EntryId";
                """);
        }

        private static readonly string[] PlanTables = ["plays", "play_plan_revisions"];

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Only the first stop of each entry survives a downgrade.
            migrationBuilder.Sql("""UPDATE play_order_links SET "LevelId" = NULL WHERE "Role" = 'Stop';""");
            foreach (var table in PlanTables)
                migrationBuilder.Sql($$"""
                    UPDATE {{table}} SET "Plan" = jsonb_set("Plan", '{entries}', (
                        SELECT jsonb_agg(CASE WHEN e ? 'stops'
                            THEN (e - 'stops') || jsonb_build_object('stop', COALESCE((e -> 'stops' -> 0) - 'share',
                                jsonb_build_object('id', (e ->> 'id') || '-stop', 'unit', 'price', 'value', '')))
                            ELSE e END ORDER BY n)
                        FROM jsonb_array_elements("Plan" -> 'entries') WITH ORDINALITY AS t(e, n)))
                    WHERE jsonb_typeof("Plan" -> 'entries') = 'array' AND jsonb_array_length("Plan" -> 'entries') > 0;
                    """);

            migrationBuilder.RenameColumn(
                name: "LevelId",
                table: "play_order_links",
                newName: "TargetId");
        }
    }
}

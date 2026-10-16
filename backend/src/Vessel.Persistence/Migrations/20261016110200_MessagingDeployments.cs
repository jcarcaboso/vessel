using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Vessel.Persistence.Migrations;

// Written by the explicit provision step only; every messaging host checks its own row at startup.
[DbContext(typeof(VesselDbContext))]
[Migration("20261016110200_MessagingDeployments")]
public sealed class MessagingDeployments : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        CREATE TABLE messaging_deployments (
            schema_name varchar(63) PRIMARY KEY, deployment varchar(48) NOT NULL, modules text[] NOT NULL,
            provisioned_at timestamptz NOT NULL
        );
        """);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql("DROP TABLE IF EXISTS messaging_deployments;");
}

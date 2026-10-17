using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Internal;

namespace Vessel.Identity;

#pragma warning disable EF1001 // EF's replacement point is public, its default implementation is marked internal.
public sealed class IdentityMigrationsAssembly(
    ICurrentDbContext current, IDbContextOptions options, IMigrationsIdGenerator ids,
    IDiagnosticsLogger<DbLoggerCategory.Migrations> logger) : MigrationsAssembly(current, options, ids, logger)
{
    private readonly IdentitySchema schema = ((IdentityDbContext)current.Context).Schema;
    public override ModelSnapshot? ModelSnapshot
    {
        get
        {
            var snapshot = base.ModelSnapshot;
            if (snapshot is Migrations.IdentityDbContextModelSnapshot identity) identity.Schema = schema;
            return snapshot;
        }
    }
    public override Migration CreateMigration(TypeInfo migrationClass, string activeProvider)
    {
        var migration = migrationClass.GetConstructor([typeof(IdentitySchema)]) is { } constructor
            ? (Migration)constructor.Invoke([schema])
            : base.CreateMigration(migrationClass, activeProvider);
        migration.ActiveProvider = activeProvider;
        return migration;
    }
}
#pragma warning restore EF1001

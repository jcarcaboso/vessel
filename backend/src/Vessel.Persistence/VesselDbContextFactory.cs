using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Vessel.Application.Ownership;

namespace Vessel.Persistence;

public sealed class VesselDbContextFactory : IDesignTimeDbContextFactory<VesselDbContext>
{
    public VesselDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Vessel");
        if (string.IsNullOrWhiteSpace(connection))
            throw new InvalidOperationException("Set ConnectionStrings__Vessel for migration tooling.");
        return new VesselDbContext(new DbContextOptionsBuilder<VesselDbContext>().UseNpgsql(connection).Options,
            new MigrationOwner());
    }

    private sealed class MigrationOwner : IJournalOwnerContext
    {
        public Guid OwnerId => Guid.Parse("11111111-1111-1111-1111-111111111111");
    }
}

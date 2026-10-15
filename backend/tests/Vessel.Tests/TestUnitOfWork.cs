using System.Runtime.CompilerServices;
using Vessel.Application.Ownership;
using Vessel.Persistence;

namespace Vessel.Tests;

internal static class TestUnitOfWork
{
    // Manually constructed test services still share exactly one boundary per context, as DI does.
    private static readonly ConditionalWeakTable<VesselDbContext, UnitOfWork> Units = new();
    public static UnitOfWork For(VesselDbContext db) => Units.GetValue(db, context => new UnitOfWork(context));
    public static IUnitOfWork None { get; } = new MemoryUnitOfWork();
    public static IUnitOfWork Saving(Func<CancellationToken, Task> save) => new MemoryUnitOfWork(save);

    private sealed class MemoryUnitOfWork(Func<CancellationToken, Task>? save = null) : IUnitOfWork
    {
        public async Task<T> ExecuteAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var result = await operation();
            await SaveChangesAsync(cancellationToken);
            return result;
        }

        public Task SaveChangesAsync(CancellationToken cancellationToken) =>
            save?.Invoke(cancellationToken) ?? Task.CompletedTask;
    }
}

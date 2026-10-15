using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Vessel.Persistence.Events;

internal static class PlayEventSql
{
    internal static DbCommand TransactionCommand(VesselDbContext db, string sql, params (string Name, object? Value)[] parameters)
    {
        // Recheck after awaits: an unawaited callback may resume after rollback closed its lease.
        RequireTransaction(db);
        return Command(db, sql, parameters);
    }

    internal static DbCommand Command(VesselDbContext db, string sql, params (string Name, object? Value)[] parameters)
    {
        var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
            command.Parameters.Add(new NpgsqlParameter(name, value ?? DBNull.Value));
        return command;
    }

    internal static void RequireTransaction(VesselDbContext db)
    {
        UnitOfWork.ForCurrentContext(db).RequireActive();
        if (db.CurrentOwnerId == Guid.Empty) throw new UnauthorizedAccessException("Missing event owner.");
    }

    internal static Task<T> ParticipateAsync<T>(VesselDbContext db, Func<Task<T>> operation, CancellationToken ct) =>
        UnitOfWork.ForCurrentContext(db).ParticipateAsync(async () =>
        {
            RequireTransaction(db);
            return await operation();
        }, ct);

    internal static Task ParticipateAsync(VesselDbContext db, Func<Task> operation, CancellationToken ct) =>
        ParticipateAsync(db, async () => { await operation(); return true; }, ct);
}

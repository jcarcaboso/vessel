using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vessel.Application.Common;
using Vessel.Application.Ownership;

namespace Vessel.Persistence;

public sealed class UnitOfWork(VesselDbContext db) : IUnitOfWork
{
    private readonly AsyncLocal<Participation?> current = new();
    private Participation? active;
    private Exception? failure;
    private bool unusable;

    public async Task<T> ExecuteAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken)
    {
        if (unusable)
            throw new InvalidOperationException("The failed transaction requires a new scope.");
        if (current.Value is { } inherited &&
            (inherited.Completing || active is null || inherited != active && inherited.Root != active))
            throw new InvalidOperationException("This participant belongs to a completed unit of work.");
        var root = new Participation();
        if (Interlocked.CompareExchange(ref active, root, null) is not null)
            return await ParticipateAsync(operation, cancellationToken);
        current.Value = root;
        failure = null;
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction = null;
        try
        {
            if (db.Database.CurrentTransaction is not null)
                throw new InvalidOperationException("The unit of work must own the database transaction.");
            cancellationToken.ThrowIfCancellationRequested();
            transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var result = await operation();
            RequireCompletedParticipation(active);
            RequireActive();
            await SaveChangesAsync(cancellationToken);
            RequireActive();
            if (!root.StartCompletion())
            {
                unusable = true;
                throw new InvalidOperationException("Unit-of-work participants must be awaited. A new scope is required.");
            }
            if (failure is not null)
                throw new InvalidOperationException("A failed participant requires the unit of work to roll back.", failure);
            cancellationToken.ThrowIfCancellationRequested();
            await transaction.CommitAsync(cancellationToken);
            return result;
        }
        catch
        {
            // Stop inherited callbacks before rollback yields, not only after disposal.
            unusable |= root.Close();
            try
            {
                if (transaction is not null) await transaction.RollbackAsync(CancellationToken.None);
            }
            catch { unusable = true; throw; }
            finally { db.ChangeTracker.Clear(); }
            throw;
        }
        finally
        {
            try
            {
                if (transaction is not null) await transaction.DisposeAsync();
            }
            finally
            {
                unusable |= root.Close();
                current.Value = null;
                active = null;
                failure = null;
            }
        }
    }

    // Locks participate but cannot start, commit or roll back a transaction.
    internal async Task<T> ParticipateAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken)
    {
        Participation? parent = null;
        var joined = false;
        try
        {
            RequireActive();
            cancellationToken.ThrowIfCancellationRequested();
            parent = current.Value!;
            if (!parent.StartChild())
                throw new InvalidOperationException("Concurrent use of a scoped unit of work is not supported.");
            joined = true;
            current.Value = new Participation { Root = active };
            var result = await operation();
            RequireCompletedParticipation(current.Value);
            RequireActive();
            if (!current.Value!.StartCompletion())
            {
                unusable = true;
                throw new InvalidOperationException("Unit-of-work participants must be awaited. A new scope is required.");
            }
            return result;
        }
        catch (Exception error)
        {
            if (joined && current.Value?.ChildRunning == true) unusable = true;
            // A stale continuation cannot poison a later operation it was never admitted to.
            if (active is { Completing: false } && (current.Value is null ||
                current.Value == active || current.Value.Root == active))
                failure ??= error;
            throw;
        }
        finally
        {
            if (joined)
            {
                // ExecutionContext copies retain this object after the callback returns.
                // Close it before releasing the parent so those copies cannot re-enter.
                unusable |= current.Value!.Close();
                current.Value = parent;
                parent!.FinishChild();
            }
            if (unusable) db.ChangeTracker.Clear();
        }
    }

    internal void RequireActive()
    {
        if (unusable || active is null || current.Value is not { } participant || participant.Completing ||
            participant != active && participant.Root != active || db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("An active unit of work is required.");
        if (failure is not null)
            throw new InvalidOperationException("A failed participant requires the unit of work to roll back.", failure);
        if (active.Completing)
            throw new InvalidOperationException("The unit of work is completing; new participants are not allowed.");
        if (participant.ChildRunning)
            throw new InvalidOperationException("Concurrent use of a scoped unit of work is not supported.");
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken) => ParticipateAsync(async () =>
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException error)
        {
            failure ??= error;
            throw new ProblemException(409, "This Play changed elsewhere. Reload it before saving again.");
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException
            { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "UX_accounts_owner_venue_source" })
        {
            failure ??= error;
            throw new ProblemException(409, "An account for this venue and source already exists. Manage or re-enable that account.");
        }
        return true;
    }, cancellationToken);

    private void RequireCompletedParticipation(Participation participant)
    {
        if (!participant.ChildRunning) return;
        // A dangling callback may still use this context. It must never join another transaction.
        unusable = true;
        throw new InvalidOperationException("Unit-of-work participants must be awaited. A new scope is required.");
    }

    private sealed class Participation
    {
        private int state;
        public Participation? Root { get; init; }
        public bool Completing => Volatile.Read(ref state) == 2;
        public bool ChildRunning => Volatile.Read(ref state) == 1;
        public bool StartChild() => Interlocked.CompareExchange(ref state, 1, 0) == 0;
        public void FinishChild() => Interlocked.CompareExchange(ref state, 0, 1);
        public bool StartCompletion() => Interlocked.CompareExchange(ref state, 2, 0) == 0;
        public bool Close() => Interlocked.Exchange(ref state, 2) == 1;
    }
}

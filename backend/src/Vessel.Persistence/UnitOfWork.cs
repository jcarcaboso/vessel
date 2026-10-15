using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using Npgsql;
using Vessel.Application.Common;
using Vessel.Application.Ownership;

namespace Vessel.Persistence;

/// <summary>
/// The scoped write boundary. The outer <see cref="ExecuteAsync{T}"/> owns the transaction; nested calls and the
/// store lock wrappers participate in it. The first participant failure is remembered and the unit rolls back even
/// when the caller catches it. Each flow is tracked by an <see cref="AsyncLocal{T}"/> participation, so a stale,
/// dangling or parallel callback is rejected instead of writing through a finished or shared transaction.
/// </summary>
public sealed class UnitOfWork(VesselDbContext db, ILogger<UnitOfWork>? logger = null) : IUnitOfWork
{
    public const string PlayConflict = "This Play changed elsewhere. Reload it before saving again.";
    public const string ExecutionConflict = "This Play changed elsewhere. Reload it and check the venue again.";
    /// <summary>Exception data key holding a rollback error that followed, and must not replace, the original failure.</summary>
    public const string RollbackErrorKey = "Vessel.UnitOfWork.RollbackError";

    private readonly AsyncLocal<Participation?> current = new();
    private Participation? active;
    private Exception? failure;
    // A dangling participant or an unknown connection state: this scope can never start another unit.
    private bool unusable;

    public async Task<T> ExecuteAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken)
    {
        if (unusable)
            throw new InvalidOperationException("The failed transaction requires a new scope.");
        if (current.Value is { } inherited && (inherited.Completing || !Belongs(inherited)))
            throw new InvalidOperationException("This participant belongs to a completed unit of work.");
        var root = new Participation(null);
        if (Interlocked.CompareExchange(ref active, root, null) is not null)
            // Nested units flush before returning, so the caller reads their writes and conflicts surface here.
            return await ParticipateAsync(async () =>
            {
                var result = await operation();
                await SaveChangesAsync(cancellationToken);
                return result;
            }, cancellationToken);
        current.Value = root;
        failure = null;
        IDbContextTransaction? transaction = null;
        try
        {
            if (db.Database.CurrentTransaction is not null)
                throw new InvalidOperationException("The unit of work must own the database transaction.");
            cancellationToken.ThrowIfCancellationRequested();
            transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var result = await operation();
            RequireAwaited(root);
            await SaveChangesAsync(cancellationToken);
            RequireActive();
            // Closes admission; it fails if a participant slipped in while the final save was running.
            if (!root.StartCompletion()) throw Dangling();
            // A participant rejected during the final save records its failure after the check above.
            if (failure is not null)
                throw new InvalidOperationException("A failed participant requires the unit of work to roll back.", failure);
            cancellationToken.ThrowIfCancellationRequested();
            // Past this point the outcome is decided; a late cancellation must not abandon the commit halfway.
            await transaction.CommitAsync(CancellationToken.None);
            return result;
        }
        catch (Exception error)
        {
            // Stop inherited callbacks before rollback yields, not only after disposal.
            unusable |= root.Close();
            await RollbackAsync(transaction, error);
            throw;
        }
        finally
        {
            try
            {
                if (transaction is not null) await transaction.DisposeAsync();
            }
            catch (Exception error)
            {
                unusable = true;
                logger?.LogError(error, "Disposing a unit-of-work transaction failed.");
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

    // Lock wrappers and store writes participate but cannot start, commit or roll back a transaction.
    internal async Task<T> ParticipateAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken)
    {
        Participation? parent = null;
        Participation? self = null;
        try
        {
            RequireActive();
            cancellationToken.ThrowIfCancellationRequested();
            parent = current.Value!;
            if (!parent.StartChild())
                throw new InvalidOperationException("Concurrent use of a scoped unit of work is not supported.");
            self = new Participation(active);
            current.Value = self;
            var result = await operation();
            RequireAwaited(self);
            RequireActive();
            if (!self.StartCompletion()) throw Dangling();
            return result;
        }
        catch (Exception error)
        {
            if (self?.ChildRunning == true) unusable = true;
            // A stale continuation cannot poison a later unit it was never admitted to.
            if (active is { Completing: false } && (current.Value is null || Belongs(current.Value)))
                failure ??= error;
            throw;
        }
        finally
        {
            if (self is not null)
            {
                // ExecutionContext copies retain this object after the callback returns.
                // Close it before releasing the parent so those copies cannot re-enter.
                unusable |= self.Close();
                current.Value = parent;
                parent!.FinishChild();
            }
            if (unusable) db.ChangeTracker.Clear();
        }
    }

    /// <summary>Throws unless the calling flow is the running, unfailed participant of the active unit.</summary>
    internal void RequireActive()
    {
        var root = active;
        if (unusable || root is null || current.Value is not { } participant || participant.Completing ||
            participant != root && participant.Root != root || db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("An active unit of work is required.");
        if (failure is not null)
            throw new InvalidOperationException("A failed participant requires the unit of work to roll back.", failure);
        if (root.Completing)
            throw new InvalidOperationException("The unit of work is completing; new participants are not allowed.");
        if (participant.ChildRunning)
            throw new InvalidOperationException("Concurrent use of a scoped unit of work is not supported.");
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken) => SaveChangesAsync(PlayConflict, cancellationToken);

    // Any running unit on this scope counts, as does a transaction the unit does not own: an EF transaction,
    // an explicitly enlisted one or an ambient System.Transactions scope.
    public bool IsActive => Volatile.Read(ref active) is not null || db.Database.CurrentTransaction is not null ||
        System.Transactions.TransactionsDatabaseFacadeExtensions.GetEnlistedTransaction(db.Database) is not null ||
        System.Transactions.Transaction.Current is not null;

    /// <summary>Flushes inside the active unit; <paramref name="conflict"/> words a Play version conflict for this area.</summary>
    internal Task SaveChangesAsync(string conflict, CancellationToken cancellationToken) => ParticipateAsync(async () =>
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException error)
        {
            failure ??= error;
            throw new ProblemException(409, conflict);
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException
            { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "UX_accounts_owner_venue_source" })
        {
            failure ??= error;
            throw new ProblemException(409, "An account for this venue and source already exists. Manage or re-enable that account.");
        }
        return true;
    }, cancellationToken);

    private bool Belongs(Participation participant) => active is { } root && (participant == root || participant.Root == root);

    private async Task RollbackAsync(IDbContextTransaction? transaction, Exception original)
    {
        try
        {
            if (transaction is not null) await transaction.RollbackAsync(CancellationToken.None);
        }
        catch (Exception error)
        {
            // The connection state is unknown. Report the original failure and keep the rollback error beside it.
            unusable = true;
            original.Data[RollbackErrorKey] = error;
            logger?.LogError(error, "Rolling back a failed unit of work failed; the original error is reported.");
        }
        finally { db.ChangeTracker.Clear(); }
    }

    private void RequireAwaited(Participation participant)
    {
        // A dangling callback may still use this context. It must never join another transaction.
        if (participant.ChildRunning) throw Dangling();
    }

    private InvalidOperationException Dangling()
    {
        unusable = true;
        return new("Unit-of-work participants must be awaited. A new scope is required.");
    }

    // 0 idle, 1 running a child participant, 2 completing or closed.
    private sealed class Participation(Participation? root)
    {
        private int state;
        public Participation? Root { get; } = root;
        public bool Completing => Volatile.Read(ref state) == 2;
        public bool ChildRunning => Volatile.Read(ref state) == 1;
        public bool StartChild() => Interlocked.CompareExchange(ref state, 1, 0) == 0;
        public void FinishChild() => Interlocked.CompareExchange(ref state, 0, 1);
        public bool StartCompletion() => Interlocked.CompareExchange(ref state, 2, 0) == 0;
        /// <summary>Closes the participation; true when a child was still running (a dangling callback).</summary>
        public bool Close() => Interlocked.Exchange(ref state, 2) == 1;
    }
}

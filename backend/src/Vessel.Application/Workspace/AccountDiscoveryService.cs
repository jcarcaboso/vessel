using Vessel.Application.Ownership;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;

namespace Vessel.Application.Workspace;

public sealed record DiscoveredAccountDto(string SourceId, string Name, string AccountType, string? AccountValueUsd,
    Guid? ExistingAccountId, bool? IsEnabled);
public sealed record AccountDiscoveryDto(string VenueId, string Address, IReadOnlyList<DiscoveredAccountDto> Accounts, string Notice);

public sealed class AccountDiscoveryService(IWorkspaceStore accounts, IJournalOwnerContext owner, IVenueRegistry venues,
    IEnumerable<IVenueAccountDiscovery> discoveries)
{
    public async Task<AccountDiscoveryDto> DiscoverAsync(string venueId, string? address, CancellationToken ct)
    {
        if (venues.Descriptor(venueId)?.Capabilities.AccountDiscovery != true)
            throw new WorkspaceException(400, "This venue does not support account discovery.");
        if (!AccountSource.IsEvmAddress(address)) throw new WorkspaceException(400, "A 42-character public hexadecimal address is required.");
        var discovery = discoveries.SingleOrDefault(d => d.VenueId == venueId)
            ?? throw new WorkspaceException(503, "Venue discovery is unavailable.");
        IReadOnlyList<VenueAccountCandidate> found;
        try
        {
            found = await discovery.DiscoverAsync(address!.ToLowerInvariant(), ct);
            if (found.Count > 1000 || found.Any(c => !AccountSource.IsAccountIndex(c.SourceId) ||
                    string.IsNullOrWhiteSpace(c.Name) || c.Name.Length > 200 || c.AccountType is not ("main" or "subaccount") ||
                    c.AccountValueUsd is { } value && !ExactAmount(value)) ||
                found.Select(c => c.SourceId).Distinct().Count() != found.Count)
                throw new VenueReadException("Invalid discovery response.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception) { throw new WorkspaceException(502, "Venue accounts could not be discovered. Try again later."); }
        // Include disabled accounts so discovery cannot suggest importing the same source again.
        var existing = (await accounts.AccountsAsync(ct)).Where(a => a.OwnerId == owner.OwnerId && a.VenueId == venueId && a.SourceId is not null)
            .ToDictionary(a => a.SourceId!);
        return new(venueId, address!.ToLowerInvariant(), found.Select(c =>
        {
            existing.TryGetValue(c.SourceId, out var account);
            return new DiscoveredAccountDto(c.SourceId, c.Name, c.AccountType, c.AccountValueUsd, account?.Id, account?.IsEnabled);
        }).ToList(), "Discovery does not import history. Add selected accounts and refresh them explicitly.");
    }

    private static bool ExactAmount(string value)
    {
        if (value.Length is < 1 or > 128) return false;
        var number = value.AsSpan();
        if (number[0] == '-') number = number[1..];
        var dot = number.IndexOf('.');
        return dot < 0 ? Digits(number) : Digits(number[..dot]) && Digits(number[(dot + 1)..]);
    }

    private static bool Digits(ReadOnlySpan<char> value) => !value.IsEmpty && value.IndexOfAnyExceptInRange('0', '9') < 0;
}

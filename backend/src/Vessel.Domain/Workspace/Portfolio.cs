namespace Vessel.Domain.Workspace;

public sealed class Portfolio
{
    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public string Name { get; private set; } = null!;
    private Portfolio() { }
    public void Rename(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        if (name.Length > 200) throw new ArgumentException("Name exceeds storage limit.");
        Name = name.Trim();
    }
    public Portfolio(Guid id, Guid ownerId, string name)
    {
        if (id == Guid.Empty || ownerId == Guid.Empty) throw new ArgumentException("IDs must be nonempty.");
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        if (name.Length > 200) throw new ArgumentException("Name exceeds storage limit.");
        Id = id; OwnerId = ownerId; Name = name.Trim();
    }
}

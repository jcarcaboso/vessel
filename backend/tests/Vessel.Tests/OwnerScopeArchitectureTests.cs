using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Vessel.Tests;

public sealed class OwnerScopeArchitectureTests
{
    [Fact]
    public void Background_work_never_creates_an_unassigned_scope()
    {
        foreach (var path in Sources().Where(p => p.Contains("/Vessel.Worker/", StringComparison.Ordinal) ||
                     p.Contains("/Vessel.Messaging/", StringComparison.Ordinal) ||
                     Path.GetFileName(p).StartsWith("Monitor", StringComparison.Ordinal)))
        {
            var source = File.ReadAllText(path);
            Assert.DoesNotMatch(@"\b(IServiceScopeFactory|CreateScope|CreateAsyncScope)\b", source);
        }
    }

    [Fact]
    public void Query_filters_are_never_bypassed()
    {
        foreach (var path in Sources()) Assert.DoesNotContain("IgnoreQueryFilters", File.ReadAllText(path));
    }

    [Fact]
    public void Ownerless_sql_is_an_explicit_reviewed_inventory()
    {
        // SQL text hashes make an added statement (even in an approved file) require an inventory review.
        // Schema migrations are separately reviewed DDL, not runtime owner-scope bypasses.
        // Advisory locks on owner-derived or previously owner-validated entity keys are inventoried too.
        // To add an entry, review the statement's scope, then copy its path|hash from this assertion's diff.
        string[] reviewed =
        [
            "Vessel.Api/EvidenceCopyCommand.cs|c9b34ee7f02a2f083c971b5bcfd2b6dfb239af4970d91d8e56dc616d55a3d9c4",
            // Server-wide identity invitations: atomic use consumption by code hash, expiry and remaining uses.
            "Vessel.Identity/IdentityService.cs|c26ffac165c6420b5dab892b98bdc6fffed4d9b01eb5f98c3e15838abdc753aa",
            // Identity-schema advisory lock only; the raw literal keeps its quoted suffix inside the SQL hash.
            "Vessel.Identity/IdentityTransaction.cs|412856c9009c100267bcaed2ee98f7bd0fadcb134bbb68fd42b5070d64427a34",
            // Identity-schema user row lock by parameterized user ID; no journal tables are accessed.
            "Vessel.Identity/IdentityTransaction.cs|e4012de46b9a1236d2044f1cb200566ccf1334562c5e9f4aecdf08440632800b",
            "Vessel.Messaging/MessagingDeployments.cs|7cef9def011385ddc17e6a8b4adb587d48f430370a1b13ad73d8395985ec579b",
            "Vessel.Messaging/MessagingDeployments.cs|a16bdafb912a647befee6a34e34df9a2211d16df05d1454b8f9d412ff1e241ae",
            "Vessel.Persistence/DiaryStore.cs|c020f566091297d43f5450ac02e794b1ea045d677575f85160310daa91b8fe9b",
            "Vessel.Persistence/Events/EventRetention.cs|05f8fdd414fdbae35682179a42f93c4155253edbfa66a0cbc539f9699a93bc96",
            "Vessel.Persistence/Events/EventStreamEpoch.cs|6b5c6a08e6efcc41d3867d722197a1f8c7afed5900c702f3305cd90c32078937",
            "Vessel.Persistence/Events/Subscriptions/EventCatchUp.cs|7225f3f3ae3c860c6e54be3ec2ae2d6512c0728b4ac7d97355722ffff8a5fed6",
            "Vessel.Persistence/Events/Subscriptions/EventDispatcher.cs|7225f3f3ae3c860c6e54be3ec2ae2d6512c0728b4ac7d97355722ffff8a5fed6",
            "Vessel.Persistence/Events/Subscriptions/EventReceiptAdmin.cs|7225f3f3ae3c860c6e54be3ec2ae2d6512c0728b4ac7d97355722ffff8a5fed6",
            "Vessel.Persistence/Events/Subscriptions/SubscriptionProgress.cs|29f0701052dbb3611ea20ace64fc9d2907dbdaedc4d05debf78bdb149406d60c",
            "Vessel.Persistence/Events/Subscriptions/SystemEventSubscriptionStore.cs|29f0701052dbb3611ea20ace64fc9d2907dbdaedc4d05debf78bdb149406d60c",
            "Vessel.Persistence/Events/Subscriptions/SystemEventSubscriptionStore.cs|33eb5f4699ea96d9ad88233bdce435edf6aac8de7ad25117b6e0983e0b899441",
            "Vessel.Persistence/Events/Subscriptions/SystemEventSubscriptionStore.cs|3cee12e62179e1aadd9bfcb5c7637482f84fa2b9659157b483e1643147ede685",
            "Vessel.Persistence/Events/Subscriptions/SystemEventSubscriptionStore.cs|c208652efd5fa6ecf778cf7f9cad719648b4c8377d222db0aba9bb202854a90f",
            "Vessel.Persistence/Events/Subscriptions/SystemEventSubscriptionStore.cs|d861bf11b70ccc91d89b833f9d76ac9e59c6ce1b5ec881e11eaa6b15fe07ba1a",
            "Vessel.Persistence/EvidenceStore.cs|c020f566091297d43f5450ac02e794b1ea045d677575f85160310daa91b8fe9b",
            "Vessel.Persistence/ExecutionStore.cs|c020f566091297d43f5450ac02e794b1ea045d677575f85160310daa91b8fe9b",
            // System discovery returns owner IDs only, including every notification table and suspended owners.
            "Vessel.Persistence/JournalOwnerInventory.cs|d3c50a4eb37bd63d3c1d6f6c83a77bfc5c8368ea3ad3bcfc4c5c045e373c1b9d",
            // Notification paging assembles both statements with the constant `visible` fragment, which
            // includes n.owner_id=@owner; parameters always bind the current scope's owner.
            "Vessel.Persistence/Notifications/NotificationStore.cs|d03c88d4e53ec73a5f089f774c05085e0223717c18d88d256fe7b673ca4ec6c7",
            "Vessel.Persistence/Notifications/NotificationStore.cs|d30491db273f29ecb15d7b278b9db3d849a3e75af4d2d5cbad9aef0e1a5807c8",
            // Advisory key is prefixed with the scope's owner GUID; it accesses no owner rows.
            "Vessel.Persistence/Notifications/NotificationStore.cs|24e428e35918edb014abb289e0a62af4270d36e3b2494a023e892e5068fb1ed2",
            // Not SQL: server-authored notification title beginning with the word "Update".
            "Vessel.Application/Notifications/NotificationComposer.cs|fb59481d31b3a452f939961f54a0da2ba0ebfb1c04c24b7cd273dcf14f79c639",
            "Vessel.Persistence/MonitorStore.cs|c020f566091297d43f5450ac02e794b1ea045d677575f85160310daa91b8fe9b",
            "Vessel.Persistence/PlayStore.cs|c020f566091297d43f5450ac02e794b1ea045d677575f85160310daa91b8fe9b",
            "Vessel.Persistence/WorkspaceStore.cs|c020f566091297d43f5450ac02e794b1ea045d677575f85160310daa91b8fe9b",
            // B2: reviewed system discovery/state, transactional venue count and budget-lock statements.
            "Vessel.Persistence/JournalOwnerInventory.cs|224d4132892dc7a2d9f090925029b0bafa3c3636d763383faf76b9f6e4f7f430",
            "Vessel.Persistence/MonitorStore.cs|11fb326c24d434a2b59624a7e4a796561d98ef3e2291f2682033d47b113996e3",
            "Vessel.Persistence/MonitorStore.cs|5d0a1ed4c9cf1315a1cb064478718b843e28efcb64c8bb63578411302ca9e1be",
            "Vessel.Persistence/MonitorStore.cs|2b6dd27282cdf69a0bfa64cbc1a4de96621d46d16d63d39f96373947271daf1d",
            "Vessel.Persistence/SystemMonitorStore.cs|e2037cb3b7902344c9316ae23e538c8738f2a6ba7b788d164ef4fd2597e43b2e",
            "Vessel.Persistence/ServerStateStore.cs|40c74c937dd0eb512282090d98087bea4726000d71185d726dbbdd89e80b5b51",
            "Vessel.Persistence/ServerStateStore.cs|4de6036152e376cb02952ca7410a4db74f2a434f16091e168cf64995f90293f8",
            "Vessel.Persistence/ServerStateStore.cs|ee73f5478e13936ed833caed3737b495efb924b2d70cbf4c9d46ca0f8ff1593a",
            "Vessel.Persistence/ServerStateStore.cs|6973e58fc649dacc48f32b3733651715ab8955080a0b79a97ecf85be116dc12c",
            "Vessel.Persistence/ServerStateStore.cs|e6dc41ee45eddfeaad9785f33c42534223f79ae4627170351a604402d4b9f9fb",
        ];
        var actual = new List<string>();
        foreach (var path in Sources().Where(p => !p.Contains("/Migrations/", StringComparison.Ordinal)))
        foreach (Match literal in Regex.Matches(File.ReadAllText(path),
                     @"\$?""""""[\s\S]*?""""""|\$?@""(?:[^""]|"""")*""|\$?""(?:\\.|[^""\\])*"""))
        {
            var sql = literal.Value.TrimStart('$', '@', '"').TrimEnd('"').Trim();
            if (!Regex.IsMatch(sql, @"^(SELECT|INSERT|UPDATE|DELETE|WITH)\b", RegexOptions.IgnoreCase) ||
                Regex.IsMatch(sql, @"@owner\b|@ownerId\b|\{[^}]*OwnerId|\{owner\}", RegexOptions.IgnoreCase)) continue;
            var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Regex.Replace(sql, @"\s+", " "))));
            actual.Add(Path.GetRelativePath(SourceRoot(), path).Replace('\\', '/') + "|" + hash);
        }
        Assert.Equal(reviewed.Order(), actual.Order());
    }

    private static IEnumerable<string> Sources() => Directory.EnumerateFiles(SourceRoot(), "*.cs", SearchOption.AllDirectories)
        .Where(p => !p.Contains("/obj/", StringComparison.Ordinal) && !p.Contains("/bin/", StringComparison.Ordinal));

    private static string SourceRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Vessel.slnx"))) directory = directory.Parent;
        Assert.NotNull(directory);
        return Path.Combine(directory.FullName, "src");
    }
}

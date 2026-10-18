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
        // OwnerlessSqlClassifier decides which literals are SQL and which fall inside its small owner-safe subset.
        // To add an entry, review the statement's scope, then copy its path|hash from this assertion's message.
        string[] reviewed =
        [
            "Vessel.Api/EvidenceCopyCommand.cs|c9b34ee7f02a2f083c971b5bcfd2b6dfb239af4970d91d8e56dc616d55a3d9c4",
            // Offline evidence copy: read-only transaction mode for its metadata read; touches no rows.
            "Vessel.Api/EvidenceCopyCommand.cs|6c20e5345ee8028f61cc0541aeb60699e5cffa99c8f79ff7f8c62b0a8dad1837",
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
            // Reviewed outside the classifier's owner-safe subset (joins, subqueries, CTEs, OR inside AND-ed groups):
            // Due-account claim: a."OwnerId" is the scope owner; monitor_accounts joins by the account's own ID.
            "Vessel.Persistence/MonitorStore.cs|a3a1b551fac4488488c59e912f3554f1750dfa35ecb473c5ac7683c8714ab4c2",
            // Run grouping: e.owner_id=@owner; cursor, subscription and sources join on e.owner_id.
            "Vessel.Persistence/Notifications/NotificationStore.cs|2e4a474f20be70278c263306f2ab99290e08adba7c8fe44ab05fc4e3a86c17eb",
            // Subject sources: CTE and s are owner-filtered; deliveries join on s.owner_id; the OR is inside an AND.
            "Vessel.Persistence/Notifications/NotificationStore.cs|09e99dedd0ebc3ed0fd43879379b208412b3bb5c3cf6847ded4ae49ed30c57e6",
            // Feed head: every scalar subquery filters owner_id=@owner.
            "Vessel.Persistence/Notifications/NotificationStore.cs|2773ae6d4cdb7845facddffd5856a71263426fdc752a68e1bd4f44fa7f46d1c6",
            // Feed page: the owner-scoped head plus a lateral d.owner_id=@owner page; Delivery is a constant column list.
            "Vessel.Persistence/Notifications/NotificationStore.cs|0447aee1702f9d12a32335189601f64e98c4cba9ea5e12d3aad8e11cc451b74c",
            // Popup claim: d.owner_id=@owner, n joins on d.owner_id, the account check on n.owner_id; OR is inside an AND.
            "Vessel.Persistence/Notifications/NotificationStore.cs|701bb1eb0d25c2ba12c391c67efa2f996f33f1a9c440ef6dea56fdd9847c6d2f",
            // One notification: n.owner_id=@owner; deliveries join on n.owner_id.
            "Vessel.Persistence/Notifications/NotificationStore.cs|b3a64abaf89b3ff014c7a7db36171e5ce8a1adb2feda5106539f507b1f59dc20",
            // Source pruning: the outer DELETE and its IN subquery both filter owner_id=@owner.
            "Vessel.Persistence/Notifications/NotificationStore.cs|2f165406dc9dd09ccca2c08e50ea368150c79d3efea3bc9cf216b3a5ac64f5ed",
            // Hub status: s.owner_id=@owner; the failed-receipt count is tied to s.owner_id.
            "Vessel.Persistence/Notifications/NotificationStore.cs|4b9c27cf5cada1fb1df64cd2b3590b64506baea367f0555f1a45116767585964",
            // State transition: every CTE and UPDATE filters @owner; callers pass constant predicates without OR.
            "Vessel.Persistence/Notifications/NotificationStore.cs|812e4f088a8cc88b291dc898a7ec138bd582ce4568a2579665d21c5fa1820900",
            // Notification deletion: every CTE, the DELETE and the cursor UPDATE filter @owner; constant predicates.
            "Vessel.Persistence/Notifications/NotificationStore.cs|d9cf24a27ca571ff67c90187a6f9ac0512de8b83c3b162e873b8fc2df51d352e",
            // Retention window: the CTE filters owner_id=@owner; the outer SELECT reads only that CTE.
            "Vessel.Persistence/Events/EventRetention.cs|08fe953a5aedb2f335f11e49a1484ed16e06953c61bf3e16b299d98429aa429f",
            // Lagging mark: UPDATE filters owner_id=@owner; the OR is inside a CASE in SET.
            "Vessel.Persistence/Events/EventRetention.cs|baa2742c79784d8c8358bae309148a6a222739eedec5632d01cbb6ab86ae1b7a",
            // Retention delete: the DELETE and its IN subquery filter owner_id=@owner; the cursor joins on e.owner_id.
            "Vessel.Persistence/Events/EventRetention.cs|07afcada101f2d867340f052fda079475f56d49cc4e9a936ea79990cc6d464c8",
            // History page: cursor CTE and lateral events both filter owner_id=@owner; the OR is inside an AND.
            "Vessel.Persistence/Events/VesselEventHistory.cs|b5665061b04cde94495b8ab29722016ac1f25809c2f51a7f0d664d0a128d67b2",
            // Baseline: inserts @owner, then copies fills filtered f."OwnerId"=@owner with their own owner ID.
            "Vessel.Persistence/Events/VesselEventStore.cs|8d594c5d4c42d91b8b5b39e88510a6fbe83d2efb33e3c486d2673e6c298caa99",
            // Catch-up scan: e.owner_id=@owner; subscription, cursor and receipts are tied to e.owner_id.
            "Vessel.Persistence/Events/Subscriptions/EventCatchUp.cs|951e3b3f0227f410c60234b5f6e650f3fde160d4782b5ed176f7e2dac488c60e",
            // Retry scan: r.owner_id=@owner; events and cursor join on r.owner_id.
            "Vessel.Persistence/Events/Subscriptions/EventCatchUp.cs|84dc3ad7952f911dc1079b72f343a76c32a154378a8959a11f78676f5c066e66",
            // Progress lock: s.owner_id=@owner; the cursor left-joins on s.owner_id.
            "Vessel.Persistence/Events/Subscriptions/EventCatchUp.cs|9518a2aa6c8732ff7d3ca41b587e42fd5ae8d5f74b76c3202f5e0b9a340e95fe",
            // Next unsettled event: e.owner_id=@owner; the receipt check is tied to e.owner_id.
            "Vessel.Persistence/Events/Subscriptions/EventCatchUp.cs|8ddd536c65505a48351e71b2df4f0160a0cd00256bc87d5d242bc2978d17719b",
            // Event lookup: e.owner_id=@owner; the cursor joins on e.owner_id.
            "Vessel.Persistence/Events/Subscriptions/EventDispatcher.cs|4d51b73db92ca8222bb6e5c31c9068de49820feac9cf1b469b3b9a1176b585d2",
            // Receipt lock: owner_id=@owner; the hole is the constant " SKIP LOCKED" suffix or empty.
            "Vessel.Persistence/Events/Subscriptions/EventDispatcher.cs|d5040693d4d45e4d8a3f3f26a8773b607a8ac68738ff73c5de06e6c0ed14ad97",
            // Receipt retry: rows match (owner, subscription, event) tuples selected with f.owner_id=@owner.
            "Vessel.Persistence/Events/Subscriptions/EventReceiptAdmin.cs|4fbcf294925800f60955937ecc536ad840bed216eb1a48435abfaee39d2f3402",
            // Subscription list: s.owner_id=@owner; receipt counts are tied to s.owner_id.
            "Vessel.Persistence/Events/Subscriptions/EventSubscriptionRegistry.cs|f028bd9900a04eb2f5dba91ffb25a20286a61cb7cec2ae79ceb140cfbfb7c10e",
            // Progress row: inserts @owner from the server-wide registration and the owner's own retention floor.
            "Vessel.Persistence/Events/Subscriptions/SubscriptionProgress.cs|6a6e7519684ffb58f2e2cf0a0af6c1baf38c72a25cd1c8174919b0c641bd0b3c",
        ];
        var actual = new List<string>();
        foreach (var path in Sources().Where(p => !p.Contains("/Migrations/", StringComparison.Ordinal)))
        foreach (Match literal in Regex.Matches(File.ReadAllText(path),
                     @"\$?""""""[\s\S]*?""""""|\$?@""(?:[^""]|"""")*""|\$?""(?:\\.|[^""\\])*"""))
        {
            if (!OwnerlessSqlClassifier.RequiresReview(OwnerlessSqlClassifier.Text(literal.Value))) continue;
            var sql = literal.Value.TrimStart('$', '@', '"').TrimEnd('"').Trim();
            var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Regex.Replace(sql, @"\s+", " "))));
            actual.Add(Path.GetRelativePath(SourceRoot(), path).Replace('\\', '/') + "|" + hash);
        }
        Assert.True(actual.Order().SequenceEqual(reviewed.Order()),
            "Unreviewed: " + string.Join(", ", actual.Except(reviewed)) + "; stale: " + string.Join(", ", reviewed.Except(actual)));
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

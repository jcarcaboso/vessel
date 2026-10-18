using Microsoft.Extensions.Configuration;
using Vessel.Api;
using Vessel.Application.Ownership;

namespace Vessel.Tests.Identity;

/// <summary><c>check-config</c> must reject everything the API/workers reject at startup, before deploy/migrate applies a bundle.</summary>
public sealed class ConfigurationCheckCommandTests
{
    private const string Secret = "synthetic-token-must-never-echo-0123456789";
    // Unreachable on purpose: the check must never open it.
    private const string Connection = "Host=192.0.2.1;Port=1;Database=none;Username=none;Password=synthetic-password;Timeout=1";

    private static IConfiguration Token(Dictionary<string, string?>? overrides = null) => Build(new()
    {
        ["Vessel:Auth:Mode"] = "Token", ["Vessel:Auth:Token"] = Secret, ["ConnectionStrings:Vessel"] = Connection
    }, overrides);

    private static IConfiguration Wallet(Dictionary<string, string?>? overrides = null) => Build(new()
    {
        ["Vessel:Auth:Mode"] = "Wallet", ["Vessel:Auth:OwnerId"] = "22222222-2222-4222-8222-222222222222",
        ["Vessel:Identity:Origins:0"] = "https://diary.example.com", ["Vessel:Identity:Registration"] = "Closed",
        ["ConnectionStrings:Vessel"] = Connection
    }, overrides);

    private static IConfiguration Build(Dictionary<string, string?> values, Dictionary<string, string?>? overrides) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.Concat(overrides ?? []).GroupBy(x => x.Key)
            .ToDictionary(x => x.Key, x => x.Last().Value)).Build();

    private static (int Code, string Output) Check(IConfiguration configuration, bool development = false)
    {
        var output = new StringWriter();
        return (ConfigurationCheckCommand.Check(configuration, development, output), output.ToString());
    }

    [Fact]
    public void Valid_token_and_wallet_configurations_pass_without_a_database()
    {
        var token = Check(Token());
        Assert.Equal(0, token.Code);
        Assert.Contains("valid for Token mode", token.Output);
        var wallet = Check(Wallet());
        Assert.Equal(0, wallet.Code);
        Assert.Contains("valid for Wallet mode", wallet.Output);
        // Development keeps the API's relaxed rules: no production token length, plain HTTP origins.
        Assert.Equal(0, Check(Wallet(new() { ["Vessel:Identity:Origins:0"] = "http://localhost:5173",
            ["Vessel:Auth:OwnerId"] = null, ["ConnectionStrings:Vessel"] = null }), development: true).Code);
    }

    public static TheoryData<string, string, string?, string> Invalid => new()
    {
        { "Token", "Vessel:Auth:Mode", "wallet", "Vessel:Auth:Mode" },
        { "Wallet", "Vessel:Auth:Mode", "wallet", "Vessel:Auth:Mode" },
        { "Token", "Vessel:Auth:Mode", "token", "Vessel:Auth:Mode" },
        { "Token", "Vessel:Auth:Token", "short", "Vessel__Auth__Token" },
        { "Token", "Vessel:Auth:Token", null, "Vessel__Auth__Token" },
        { "Token", "ConnectionStrings:Vessel", null, "ConnectionStrings__Vessel" },
        { "Token", "Vessel:Identity:Registration", "Clsoed", "Vessel:Identity:Registration" },
        { "Wallet", "Vessel:Identity:Origins:0", "http://diary.example.com", "Vessel:Identity:Origins" },
        { "Wallet", "Vessel:Identity:Origins:0", null, "Vessel:Identity:Origins" },
        { "Wallet", "Vessel:Identity:Registration", "Clsoed", "Vessel:Identity:Registration" },
        { "Wallet", "Vessel:Identity:AllowList:0", "not-an-address", "Vessel:Identity:AllowList" },
        { "Wallet", "Vessel:Identity:Session:IdleHours", "48", "Vessel:Identity:Session" },
        { "Wallet", "Vessel:Identity:MaxSessionsPerUser", "0", "Vessel:Identity:MaxSessionsPerUser" },
        { "Wallet", "Vessel:Identity:CookieName", "vessel", "Vessel:Identity:CookieName" },
        { "Wallet", "Vessel:Identity:Schema", "Bad-Schema", "Vessel:Identity:Schema" },
        { "Wallet", "Vessel:Auth:Token", Secret, "Vessel:Auth:Token" },
        { "Wallet", "Vessel:Auth:OwnerId", null, "Vessel:Auth:OwnerId" },
        { "Wallet", "Vessel:Auth:OwnerId", "not-a-guid", "Vessel:Auth:OwnerId" },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public void Configurations_the_application_rejects_fail_with_the_setting_name_only(string mode, string key, string? value, string named)
    {
        var overrides = new Dictionary<string, string?> { [key] = value };
        var (code, output) = Check(mode == "Token" ? Token(overrides) : Wallet(overrides));
        Assert.Equal(1, code);
        Assert.Contains(named, output);
        Assert.DoesNotContain(Secret, output);
        Assert.DoesNotContain("synthetic-password", output);
        Assert.DoesNotContain("diary.example.com", output);
    }

    [Fact]
    public void Legacy_default_owner_needs_the_explicit_flag_and_then_warns()
    {
        var legacy = new Dictionary<string, string?> { ["Vessel:Auth:OwnerId"] = JournalOwner.Default.ToString() };
        Assert.Equal(1, Check(Wallet(legacy)).Code);
        legacy["Vessel:Identity:AllowLegacyDefaultOwner"] = "true";
        var (code, output) = Check(Wallet(legacy));
        Assert.Equal(0, code);
        Assert.Contains("AllowLegacyDefaultOwner", output);
    }

    [Theory]
    [InlineData("AllowList", true)]
    [InlineData("Open", true)]
    [InlineData("Invitation", false)]
    [InlineData("Closed", false)]
    public void Registration_without_quotas_is_valid_but_warned(string registration, bool warned)
    {
        var (code, output) = Check(Wallet(new() { ["Vessel:Identity:Registration"] = registration }));
        Assert.Equal(0, code);
        Assert.Equal(warned, output.Contains("unsupported until per-user quotas exist", StringComparison.Ordinal));
    }

    [Fact]
    public void Binder_errors_never_quote_configured_values()
    {
        var (code, output) = Check(Wallet(new() { ["Vessel:Identity:AllowLegacyDefaultOwner"] = "synthetic-not-a-bool" }));
        Assert.Equal(1, code);
        Assert.DoesNotContain("synthetic-not-a-bool", output);
    }

    [Fact]
    public void Positional_arguments_are_a_usage_error()
    {
        var output = new StringWriter();
        Assert.Equal(2, ConfigurationCheckCommand.Run(["unexpected"], output));
        Assert.Contains("check-config", output.ToString());
    }
}

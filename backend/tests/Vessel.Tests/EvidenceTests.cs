using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Npgsql;
using Vessel.Application.Evidence;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Evidence;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Infrastructure;
using Vessel.Infrastructure.Evidence;

namespace Vessel.Tests;

internal static class EvidenceFixtures
{
    public static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
    public static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 5, 6];
    public static readonly byte[] WebP = [.. "RIFF"u8, 9, 0, 0, 0, .. "WEBP"u8, 7];

    public static Play PlayFor(Guid owner) =>
        TestPlays.Create(new Account(Guid.NewGuid(), owner, "hyperliquid", "Account"), new PerpetualInstrument("hyperliquid", "BTC"));
}

internal sealed class MemoryEvidenceStore(Guid ownerId) : IEvidenceMetadataStore
{
    public List<Play> Plays { get; } = [];
    public List<PlayEvidence> Items { get; } = [];
    public Exception? AddFailure { get; set; }
    public int Saves { get; private set; }
    public Task<Play?> PlayAsync(Guid playId, CancellationToken ct) => Task.FromResult(Plays.SingleOrDefault(p => p.Id == playId && p.OwnerId == ownerId));
    public Task<List<PlayEvidence>> ListAsync(Guid playId, CancellationToken ct) =>
        Task.FromResult(Items.Where(e => e.PlayId == playId && e.OwnerId == ownerId).OrderBy(e => e.CreatedAtUtc).ToList());
    public Task<int> CountAsync(Guid playId, CancellationToken ct) => Task.FromResult(Items.Count(e => e.PlayId == playId && e.OwnerId == ownerId));
    public Task<PlayEvidence?> FindAsync(Guid id, CancellationToken ct) => Task.FromResult(Items.SingleOrDefault(e => e.Id == id && e.OwnerId == ownerId));
    public Task AddAsync(PlayEvidence evidence, CancellationToken ct)
    {
        if (AddFailure is not null) return Task.FromException(AddFailure);
        Items.Add(evidence);
        return Task.CompletedTask;
    }
    public Task RemoveAsync(PlayEvidence evidence, CancellationToken ct) { Items.Remove(evidence); return Task.CompletedTask; }
    public Task SaveAsync(CancellationToken ct) { Saves++; return Task.CompletedTask; }
}

internal sealed class MemoryObjectStore : IEvidenceObjectStore
{
    public Dictionary<string, byte[]> Objects { get; } = [];
    public bool FailDeletes { get; set; }
    public async Task PutAsync(string key, Stream content, CancellationToken ct)
    {
        using var copy = new MemoryStream();
        await content.CopyToAsync(copy, ct);
        if (!Objects.TryAdd(key, copy.ToArray())) throw new IOException("Key exists.");
    }
    public Task<Stream?> OpenReadAsync(string key, CancellationToken ct) =>
        Task.FromResult<Stream?>(Objects.TryGetValue(key, out var bytes) ? new MemoryStream(bytes) : null);
    public Task DeleteAsync(string key, CancellationToken ct)
    {
        if (FailDeletes) throw new IOException("Storage unavailable.");
        Objects.Remove(key);
        return Task.CompletedTask;
    }
}

public sealed class EvidenceTests : IDisposable
{
    private readonly Guid owner = Guid.NewGuid();
    private readonly MemoryEvidenceStore store;
    private readonly MemoryObjectStore objects = new();
    private readonly Play play;
    private readonly string root = Path.Combine(Path.GetTempPath(), "vessel-evidence-" + Guid.NewGuid().ToString("N"));

    public EvidenceTests()
    {
        store = new MemoryEvidenceStore(owner);
        play = EvidenceFixtures.PlayFor(owner);
        store.Plays.Add(play);
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }

    private EvidenceService Service(EvidenceLimits? limits = null) =>
        new(store, objects, limits ?? EvidenceLimits.Default, new CoreOwner(owner), TimeProvider.System);

    private static async Task<WorkspaceException> Rejects(Func<Task> action) => await Assert.ThrowsAsync<WorkspaceException>(action);

    [Fact]
    public void Detects_formats_from_signatures_only()
    {
        Assert.Equal("image/png", EvidenceImage.Detect(EvidenceFixtures.Png)?.ContentType);
        Assert.Equal("image/jpeg", EvidenceImage.Detect(EvidenceFixtures.Jpeg)?.ContentType);
        Assert.Equal("image/webp", EvidenceImage.Detect(EvidenceFixtures.WebP)?.ContentType);
        Assert.Null(EvidenceImage.Detect("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"u8));
        Assert.Null(EvidenceImage.Detect("GIF89a"u8));
        Assert.Null(EvidenceImage.Detect([.. "RIFF"u8, 0, 0, 0, 0, .. "WAVE"u8]));
        Assert.Null(EvidenceImage.Detect([]));
    }

    [Fact]
    public async Task Upload_stores_bytes_then_metadata_with_hash_and_generated_key()
    {
        var result = await Service().UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "Breakout retest", "capture", null, default);
        var saved = Assert.Single(store.Items);
        Assert.Equal(("capture", "image/png", 12L, "Breakout retest"), (result.Source, result.ContentType, result.SizeBytes, result.Note));
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(EvidenceFixtures.Png)), result.Sha256);
        Assert.Equal($"{owner:N}/{play.Id:N}/{result.Id:N}.png", saved.ObjectKey);
        Assert.Equal(EvidenceFixtures.Png, objects.Objects[saved.ObjectKey]);
        var upload = await Service().UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Jpeg), null, null, null, default);
        Assert.Equal(("upload", "image/jpeg", ""), (upload.Source, upload.ContentType, upload.Note));
    }

    [Fact]
    public async Task Upload_rejects_invalid_input_before_storing_anything()
    {
        var service = Service(new EvidenceLimits(16, 50));
        Assert.Equal(404, (await Rejects(() => service.UploadAsync(Guid.NewGuid(), new MemoryStream(EvidenceFixtures.Png), "", null, null, default))).StatusCode);
        var foreign = EvidenceFixtures.PlayFor(Guid.NewGuid());
        store.Plays.Add(foreign);
        Assert.Equal(404, (await Rejects(() => service.UploadAsync(foreign.Id, new MemoryStream(EvidenceFixtures.Png), "", null, null, default))).StatusCode);
        Assert.Equal(400, (await Rejects(() => service.UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "", "screenshot", null, default))).StatusCode);
        Assert.Equal(400, (await Rejects(() => service.UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), new string('x', 4001), null, null, default))).StatusCode);
        Assert.Equal(400, (await Rejects(() => service.UploadAsync(play.Id, new MemoryStream(), "", null, null, default))).StatusCode);
        Assert.Equal(413, (await Rejects(() => service.UploadAsync(play.Id, new MemoryStream(new byte[17]), "", null, null, default))).StatusCode);
        Assert.Equal(415, (await Rejects(() => service.UploadAsync(play.Id, new MemoryStream("not an image"u8.ToArray()), "", null, null, default))).StatusCode);
        Assert.Empty(store.Items);
        Assert.Empty(objects.Objects);
    }

    [Fact]
    public async Task Upload_enforces_the_per_play_limit()
    {
        var service = Service(new EvidenceLimits(1024, 2));
        await service.UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "", null, null, default);
        await service.UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "", null, null, default);
        Assert.Equal(409, (await Rejects(() => service.UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "", null, null, default))).StatusCode);
        Assert.Equal(2, objects.Objects.Count);
    }

    [Fact]
    public async Task Failed_metadata_write_removes_the_stored_object()
    {
        store.AddFailure = new InvalidOperationException("database down");
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service().UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "", null, null, default));
        Assert.Empty(objects.Objects);
    }

    [Fact]
    public async Task Notes_update_content_streams_and_delete_removes_record_then_object()
    {
        var service = Service();
        var created = await service.UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.WebP), "first", null, null, default);
        var updated = await service.UpdateNoteAsync(created.Id, new("Second thoughts"), default);
        Assert.Equal("Second thoughts", updated.Note);
        Assert.True(updated.UpdatedAtUtc >= created.UpdatedAtUtc);
        Assert.Equal(1, store.Saves);
        Assert.Equal(400, (await Rejects(() => service.UpdateNoteAsync(created.Id, new(new string('x', 4001)), default))).StatusCode);

        var content = await service.ContentAsync(created.Id, default);
        using (var copy = new MemoryStream()) { await content.Content.CopyToAsync(copy); Assert.Equal(EvidenceFixtures.WebP, copy.ToArray()); }
        Assert.Equal("image/webp", content.ContentType);
        Assert.Equal("Second thoughts", Assert.Single(await service.ListAsync(play.Id, default)).Note);

        objects.FailDeletes = true;
        await service.DeleteAsync(created.Id, default);
        Assert.Empty(store.Items);
        Assert.Single(objects.Objects); // Left unreferenced; the record is already gone.
        Assert.Equal(404, (await Rejects(() => service.ContentAsync(created.Id, default))).StatusCode);
        Assert.Equal(404, (await Rejects(() => service.DeleteAsync(created.Id, default))).StatusCode);
    }

    [Fact]
    public async Task Missing_object_reads_as_not_found()
    {
        var created = await Service().UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "", null, null, default);
        objects.Objects.Clear();
        Assert.Equal(404, (await Rejects(() => Service().ContentAsync(created.Id, default))).StatusCode);
    }

    [Fact]
    public async Task Local_store_round_trips_without_overwriting_or_leaving_temporary_files()
    {
        var local = new LocalEvidenceObjectStore(root);
        await local.PutAsync("owner/play/item.png", new MemoryStream(EvidenceFixtures.Png), default);
        await using (var read = await local.OpenReadAsync("owner/play/item.png", default))
        {
            using var copy = new MemoryStream();
            await read!.CopyToAsync(copy);
            Assert.Equal(EvidenceFixtures.Png, copy.ToArray());
        }
        await Assert.ThrowsAsync<IOException>(() => local.PutAsync("owner/play/item.png", new MemoryStream(EvidenceFixtures.Jpeg), default));
        Assert.Equal(["item.png"], Directory.GetFiles(Path.Combine(root, "owner", "play")).Select(Path.GetFileName));
        await local.DeleteAsync("owner/play/item.png", default);
        await local.DeleteAsync("owner/play/item.png", default);
        Assert.Null(await local.OpenReadAsync("owner/play/item.png", default));
        Assert.Null(await local.OpenReadAsync("owner/other/item.png", default));
    }

    [Theory]
    [InlineData("../outside.png")]
    [InlineData("owner/../../outside.png")]
    [InlineData("/etc/passwd.png")]
    [InlineData("Owner/item.png")]
    [InlineData("owner/item")]
    [InlineData("owner\\item.png")]
    public async Task Local_store_rejects_keys_it_did_not_generate(string key)
    {
        var local = new LocalEvidenceObjectStore(root);
        await Assert.ThrowsAsync<ArgumentException>(() => local.PutAsync(key, new MemoryStream(EvidenceFixtures.Png), default));
        await Assert.ThrowsAsync<ArgumentException>(() => local.OpenReadAsync(key, default));
        Assert.False(Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root, "*", SearchOption.AllDirectories).Any());
    }
}

public sealed class EvidenceApiTests : IDisposable
{
    private readonly Guid owner = Guid.NewGuid();
    private readonly MemoryEvidenceStore store;
    private readonly MemoryObjectStore objects = new();
    private readonly Play play;
    private readonly string root = Path.Combine(Path.GetTempPath(), "vessel-evidence-api-" + Guid.NewGuid().ToString("N"));

    public EvidenceApiTests()
    {
        store = new MemoryEvidenceStore(owner);
        play = EvidenceFixtures.PlayFor(owner);
        store.Plays.Add(play);
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }

    private CoreApiFactory Factory(Dictionary<string, string?>? settings = null, bool memoryObjects = true) => new(owner,
        settings: new Dictionary<string, string?> { ["Vessel:Evidence:Storage:Local:RootPath"] = root }
            .Concat(settings ?? []).ToDictionary(),
        configure: services =>
        {
            services.AddSingleton<IEvidenceMetadataStore>(store);
            if (memoryObjects) services.AddSingleton<IEvidenceObjectStore>(objects);
        });

    private static MultipartFormDataContent Form(byte[] bytes, string? note = null, string? source = null, string type = "image/png")
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(type);
        form.Add(file, "file", "chart.png");
        if (note is not null) form.Add(new StringContent(note), "note");
        if (source is not null) form.Add(new StringContent(source), "source");
        return form;
    }

    [Theory]
    [InlineData("GET", "/api/plays/11111111-1111-1111-1111-111111111111/evidence")]
    [InlineData("POST", "/api/plays/11111111-1111-1111-1111-111111111111/evidence")]
    [InlineData("GET", "/api/evidence/11111111-1111-1111-1111-111111111111/content")]
    [InlineData("PATCH", "/api/evidence/11111111-1111-1111-1111-111111111111")]
    [InlineData("DELETE", "/api/evidence/11111111-1111-1111-1111-111111111111")]
    public async Task Routes_require_authentication(string method, string path)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(new(new HttpMethod(method), path))).StatusCode);
    }

    [Fact]
    public async Task Upload_list_read_edit_and_delete_through_local_storage()
    {
        await using var factory = Factory(memoryObjects: false);
        using var client = factory.AuthorizedClient();
        var upload = await client.PostAsync($"/api/plays/{play.Id}/evidence", Form(EvidenceFixtures.Png, "Retest of the range high", "capture", type: "text/plain"));
        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);
        using var created = JsonDocument.Parse(await upload.Content.ReadAsStringAsync());
        var body = created.RootElement;
        var id = body.GetProperty("id").GetGuid();
        Assert.Equal($"/api/evidence/{id}", upload.Headers.Location?.OriginalString);
        Assert.Equal(new[] { "id", "playId", "source", "contentType", "sizeBytes", "sha256", "note", "createdAtUtc", "updatedAtUtc", "markup" },
            body.EnumerateObject().Select(p => p.Name));
        // The declared type is ignored; the signature decides.
        Assert.Equal("image/png", body.GetProperty("contentType").GetString());
        Assert.Equal("capture", body.GetProperty("source").GetString());
        Assert.True(File.Exists(Path.Combine(root, $"{owner:N}", $"{play.Id:N}", $"{id:N}.png")));

        var list = await client.GetFromJsonAsync<JsonElement>($"/api/plays/{play.Id}/evidence");
        Assert.Equal(id, Assert.Single(list.EnumerateArray()).GetProperty("id").GetGuid());

        var content = await client.GetAsync($"/api/evidence/{id}/content");
        Assert.Equal(HttpStatusCode.OK, content.StatusCode);
        Assert.Equal("image/png", content.Content.Headers.ContentType?.MediaType);
        Assert.Equal(EvidenceFixtures.Png, await content.Content.ReadAsByteArrayAsync());
        Assert.Equal("nosniff", content.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.True(content.Headers.CacheControl?.NoStore);

        var patched = await client.PatchAsJsonAsync($"/api/evidence/{id}", new { note = "Edited" });
        Assert.Equal("Edited", (await patched.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("note").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PatchAsJsonAsync($"/api/evidence/{id}", new { })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/evidence/{id}")).StatusCode);
        Assert.False(File.Exists(Path.Combine(root, $"{owner:N}", $"{play.Id:N}", $"{id:N}.png")));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/evidence/{id}/content")).StatusCode);
    }

    [Fact]
    public async Task Rejects_foreign_plays_wrong_forms_and_non_images()
    {
        var foreign = EvidenceFixtures.PlayFor(Guid.NewGuid());
        store.Plays.Add(foreign);
        await using var factory = Factory();
        using var client = factory.AuthorizedClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/api/plays/{foreign.Id}/evidence", Form(EvidenceFixtures.Png))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/plays/{foreign.Id}/evidence")).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.PostAsJsonAsync($"/api/plays/{play.Id}/evidence", new { note = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.PostAsync($"/api/plays/{play.Id}/evidence", Form("<svg/>"u8.ToArray(), type: "image/svg+xml"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/plays/{play.Id}/evidence", new MultipartFormDataContent { { new StringContent("x"), "note" } })).StatusCode);
        var two = Form(EvidenceFixtures.Png);
        two.Add(new ByteArrayContent(EvidenceFixtures.Png), "file", "second.png");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/plays/{play.Id}/evidence", two)).StatusCode);
        var problem = await (await client.PostAsync($"/api/plays/{play.Id}/evidence", Form(EvidenceFixtures.Png, source: "screen"))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Source must be capture or upload.", problem.GetProperty("detail").GetString());
        Assert.Empty(objects.Objects);
    }

    [Fact]
    public async Task Applies_configured_size_limit()
    {
        await using var factory = Factory(new() { ["Vessel:Evidence:MaxUploadBytes"] = "16" });
        using var client = factory.AuthorizedClient();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync($"/api/plays/{play.Id}/evidence", Form(EvidenceFixtures.Png))).StatusCode);
        var response = await client.PostAsync($"/api/plays/{play.Id}/evidence", Form([.. EvidenceFixtures.Png, .. new byte[8]]));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Single(objects.Objects);
    }

    [Fact]
    public async Task Unknown_storage_provider_fails_at_startup()
    {
        // A plain host: WebApplicationFactory's deferred host can dispose its services before the startup error surfaces.
        var builder = Host.CreateApplicationBuilder();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Vessel:Evidence:Storage:Provider"] = "S3" });
        builder.Services.AddVesselInfrastructure(builder.Configuration);
        using var host = builder.Build();
        var error = await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
        Assert.Contains("Provider must be Local", error.Message);
    }

    [Fact]
    public void Default_settings_use_local_storage_under_the_content_root()
    {
        var defaults = new EvidenceSettings();
        Assert.Equal(("Local", "data/evidence", 10L * 1024 * 1024, 50),
            (defaults.Storage.Provider, defaults.Storage.Local.RootPath, defaults.MaxUploadBytes, defaults.MaxPerPlay));
    }
}

public sealed class EvidencePostgresTests
{
    [PostgresFact]
    public async Task Migration_stores_owner_scoped_evidence_restricted_to_its_play()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var other = Guid.NewGuid();
        var account = new Account(Guid.NewGuid(), owner, "hyperliquid", "Account");
        var play = TestPlays.Create(account, new PerpetualInstrument("hyperliquid", "BTC"));
        var evidence = new PlayEvidence(Guid.NewGuid(), play, $"{owner:N}/{play.Id:N}/a.png", "image/png", 12,
            new string('a', 64), EvidenceSource.Capture, "Note", DateTimeOffset.Parse("2026-10-02T10:00:00Z"));
        await using (var db = database.Context(owner))
        {
            db.Accounts.Add(account);
            db.Plays.Add(play);
            db.Evidence.Add(evidence);
            await db.SaveChangesAsync();
        }
        await using (var db = database.Context(owner))
        {
            var tracked = await db.Evidence.SingleAsync();
            tracked.UpdateMarkup(EvidenceMarkup.Serialize(new ImageMarkup(10, 10, [new("a", "box", "#ffffff", 2, From: new(1, 1), To: new(5, 5))])), DateTimeOffset.UtcNow);
            await db.SaveChangesAsync();
            Assert.Equal("box", (await db.Database.SqlQueryRaw<string>("SELECT \"Markup\"->'shapes'->0->>'kind' AS \"Value\" FROM play_evidence").SingleAsync()));
        }
        await using (var db = database.Context(owner))
        {
            var stored = await new Vessel.Persistence.EvidenceStore(db).ListAsync(play.Id, default);
            Assert.Equal(("Note", EvidenceSource.Capture, 12L), (Assert.Single(stored).Note, stored[0].Source, stored[0].SizeBytes));
            db.Plays.Remove(await db.Plays.SingleAsync());
            var restrict = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            Assert.Equal(PostgresErrorCodes.RestrictViolation, Assert.IsType<PostgresException>(restrict.InnerException).SqlState);
        }
        await using (var db = database.Context(other))
        {
            Assert.Empty(await db.Evidence.ToListAsync());
            Assert.Null(await new Vessel.Persistence.EvidenceStore(db).FindAsync(evidence.Id, default));
            var stolen = await db.Evidence.IgnoreQueryFilters().SingleAsync();
            stolen.UpdateNote("Changed", DateTimeOffset.UtcNow);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => db.SaveChangesAsync());
        }
        await using (var db = database.Context(owner))
        {
            var sneaky = new PlayEvidence(Guid.NewGuid(), play, $"{owner:N}/{play.Id:N}/b.png", "image/png", 1,
                new string('A', 64), EvidenceSource.Upload, "", DateTimeOffset.UtcNow);
            db.Evidence.Add(sneaky);
            var check = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            Assert.Equal(PostgresErrorCodes.CheckViolation, Assert.IsType<PostgresException>(check.InnerException).SqlState);
        }
    }
}

public sealed class EvidenceMarkupTests
{
    private static MarkupShape Pen(string id = "a") => new(id, "pen", "#ff5c5c", 4, [new(1, 2), new(3.5, 4)]);
    private static ImageMarkup With(params MarkupShape[] shapes) => new(800, 600, shapes);
    private static string Rejects(ImageMarkup? markup) => Assert.Throws<WorkspaceException>(() => EvidenceMarkup.Normalize(markup)).Message;

    [Fact]
    public void Keeps_only_the_fields_each_kind_uses()
    {
        var normalized = EvidenceMarkup.Normalize(With(
            Pen() with { From = new(0, 0), Text = "dropped" },
            new("b", "marker", "#ffd23f", 16, [new(10, 10)]),
            new("c", "arrow", "#4ade80", 3, Points: [new(1, 1)], From: new(0, 0), To: new(800, 600)),
            new("d", "box", "#60a5fa", 3, From: new(5, 5), To: new(50, 40), Size: 9),
            new("e", "text", "#ffffff", Width: 3, At: new(10, 20), Size: 24, Text: "Retest here")));
        Assert.Equal(
            """{"width":800,"height":600,"shapes":[{"id":"a","kind":"pen","color":"#ff5c5c","width":4,"points":[{"x":1,"y":2},{"x":3.5,"y":4}]},{"id":"b","kind":"marker","color":"#ffd23f","width":16,"points":[{"x":10,"y":10}]},{"id":"c","kind":"arrow","color":"#4ade80","width":3,"from":{"x":0,"y":0},"to":{"x":800,"y":600}},{"id":"d","kind":"box","color":"#60a5fa","width":3,"from":{"x":5,"y":5},"to":{"x":50,"y":40}},{"id":"e","kind":"text","color":"#ffffff","at":{"x":10,"y":20},"size":24,"text":"Retest here"}]}""",
            EvidenceMarkup.Serialize(normalized));
        Assert.Equal(normalized.Shapes.Count, EvidenceMarkup.Read(EvidenceMarkup.Serialize(normalized))!.Shapes.Count);
    }

    [Fact]
    public void Rejects_invalid_markup()
    {
        Assert.Contains("required", Rejects(null));
        Assert.Contains("width and height", Rejects(new ImageMarkup(0, 600, [])));
        Assert.Contains("width and height", Rejects(new ImageMarkup(800, 20001, [])));
        Assert.Contains("200 shapes", Rejects(With([.. Enumerable.Range(0, 201).Select(i => Pen($"s{i}"))])));
        Assert.Contains("unique ID", Rejects(With(Pen(), Pen())));
        Assert.Contains("unique ID", Rejects(With(Pen("bad id"))));
        Assert.Contains("#rrggbb", Rejects(With(Pen() with { Color = "#FF5C5C" })));
        Assert.Contains("#rrggbb", Rejects(With(Pen() with { Color = "red" })));
        Assert.Contains("inside the image", Rejects(With(Pen() with { Points = [new(801, 0)] })));
        Assert.Contains("inside the image", Rejects(With(new MarkupShape("a", "box", "#ffffff", 3, From: new(-1, 0), To: new(5, 5)))));
        Assert.Contains("inside the image", Rejects(With(new MarkupShape("a", "arrow", "#ffffff", 3, From: new(1, 1)))));
        Assert.Contains("Stroke width", Rejects(With(Pen() with { Width = 0 })));
        Assert.Contains("Stroke width", Rejects(With(Pen() with { Width = null })));
        Assert.Contains("1 to 2000 points", Rejects(With(Pen() with { Points = [] })));
        Assert.Contains("1 to 2000 points", Rejects(With(Pen() with { Points = [.. Enumerable.Repeat(new MarkupPoint(1, 1), 2001)] })));
        Assert.Contains("Text size", Rejects(With(new MarkupShape("a", "text", "#ffffff", At: new(1, 1), Text: "x"))));
        Assert.Contains("control characters", Rejects(With(new MarkupShape("a", "text", "#ffffff", At: new(1, 1), Size: 20, Text: "line\nbreak"))));
        Assert.Contains("control characters", Rejects(With(new MarkupShape("a", "text", "#ffffff", At: new(1, 1), Size: 20, Text: "   "))));
        Assert.Contains("control characters", Rejects(With(new MarkupShape("a", "text", "#ffffff", At: new(1, 1), Size: 20, Text: new string('x', 281)))));
        Assert.Contains("kinds are", Rejects(With(Pen() with { Kind = "circle" })));
        Assert.Equal("Markup must be valid JSON.", Assert.Throws<WorkspaceException>(() => EvidenceMarkup.Parse("{")).Message);
    }

    [Fact]
    public async Task Service_replaces_and_clears_marks_without_touching_the_image()
    {
        var owner = Guid.NewGuid();
        var store = new MemoryEvidenceStore(owner);
        var objects = new MemoryObjectStore();
        var play = EvidenceFixtures.PlayFor(owner);
        store.Plays.Add(play);
        var service = new EvidenceService(store, objects, EvidenceLimits.Default, new CoreOwner(owner), TimeProvider.System);
        var created = await service.UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "", "capture",
            """{"width":800,"height":600,"shapes":[{"id":"a","kind":"box","color":"#ff5c5c","width":3,"from":{"x":1,"y":1},"to":{"x":9,"y":9},"text":"x"}]}""", default);
        Assert.Equal("box", Assert.Single(created.Markup!.Shapes).Kind);
        Assert.Null(created.Markup.Shapes[0].Text);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() =>
            service.UploadAsync(play.Id, new MemoryStream(EvidenceFixtures.Png), "", null, """{"width":1}""", default))).StatusCode);

        var updated = await service.UpdateMarkupAsync(created.Id, With(Pen()), default);
        Assert.Equal("pen", Assert.Single(updated.Markup!.Shapes).Kind);
        Assert.Null((await service.UpdateMarkupAsync(created.Id, null, default)).Markup);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => service.UpdateMarkupAsync(created.Id, With(Pen() with { Color = "red" }), default))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.UpdateMarkupAsync(Guid.NewGuid(), null, default))).StatusCode);
        Assert.Equal(EvidenceFixtures.Png, Assert.Single(objects.Objects).Value);
    }

    [Fact]
    public async Task Api_puts_and_deletes_marks()
    {
        var owner = Guid.NewGuid();
        var store = new MemoryEvidenceStore(owner);
        var play = EvidenceFixtures.PlayFor(owner);
        store.Plays.Add(play);
        var objects = new MemoryObjectStore();
        await using var factory = new CoreApiFactory(owner, configure: services =>
        {
            services.AddSingleton<IEvidenceMetadataStore>(store);
            services.AddSingleton<IEvidenceObjectStore>(objects);
        });
        using var client = factory.AuthorizedClient();
        var form = new MultipartFormDataContent { { new ByteArrayContent(EvidenceFixtures.Png), "file", "a.png" },
            { new StringContent("""{"width":10,"height":10,"shapes":[{"id":"t","kind":"text","color":"#ffffff","at":{"x":1,"y":1},"size":4,"text":"Hi"}]}"""), "markup" } };
        var created = await (await client.PostAsync($"/api/plays/{play.Id}/evidence", form)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Hi", created.GetProperty("markup").GetProperty("shapes")[0].GetProperty("text").GetString());
        var id = created.GetProperty("id").GetGuid();

        var put = await client.PutAsJsonAsync($"/api/evidence/{id}/markup", new { width = 10, height = 10, shapes = new[] { new { id = "p", kind = "pen", color = "#4ade80", width = 1, points = new[] { new { x = 2, y = 3 } } } } });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal("pen", (await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("markup").GetProperty("shapes")[0].GetProperty("kind").GetString());
        var bad = await client.PutAsJsonAsync($"/api/evidence/{id}/markup", new { width = 10, height = 10, shapes = new[] { new { id = "p", kind = "pen", color = "#4ade80", width = 1, points = new[] { new { x = 20, y = 3 } } } } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal("Mark points must lie inside the image.", (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString());

        var cleared = await client.DeleteAsync($"/api/evidence/{id}/markup");
        Assert.Equal(JsonValueKind.Null, (await cleared.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("markup").ValueKind);
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.DeleteAsync($"/api/evidence/{id}/markup")).StatusCode);
        Assert.Equal(EvidenceFixtures.Png, await client.GetByteArrayAsync($"/api/evidence/{id}/content"));
    }
}

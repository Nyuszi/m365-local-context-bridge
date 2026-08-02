using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using LocalContextBridge.Core.Models;
using LocalContextBridge.Core.Security;
using LocalContextBridge.Core.Services;
using LocalContextBridge.Core.Tools;
using Microsoft.AspNetCore.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

var isDocker = string.Equals(Environment.GetEnvironmentVariable("LOCAL_CONTEXT_BRIDGE_DOCKER"), "1", StringComparison.Ordinal);
var port = int.TryParse(builder.Configuration["Bridge:Port"], out var p) ? p : 32178;
var version = builder.Configuration["Bridge:Version"] ?? "0.1.0";

var dataDir = Environment.GetEnvironmentVariable("LOCAL_CONTEXT_BRIDGE_DATA");
if (string.IsNullOrWhiteSpace(dataDir))
{
    if (OperatingSystem.IsMacOS())
        dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Library", "Application Support", "LocalContextBridge");
    else if (OperatingSystem.IsWindows())
        dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LocalContextBridge");
    else
        dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share", "LocalContextBridge");
}
Directory.CreateDirectory(dataDir);

if (isDocker)
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
else
    builder.WebHost.UseUrls($"http://127.0.0.1:{port}");

var limits = new BridgeLimits();
builder.Services.AddSingleton(limits);
builder.Services.AddSingleton(new PathSecurityService());
builder.Services.AddSingleton(new SecretRedactionService());
builder.Services.AddSingleton(new BinaryDetectionService());
builder.Services.AddSingleton(new OutputTruncationService());
builder.Services.AddSingleton(new ReplayProtectionService());
builder.Services.AddSingleton(new ApprovedRootRegistry(dataDir));
builder.Services.AddSingleton(new PairingService(dataDir));
builder.Services.AddSingleton(new PreferenceStore(dataDir));
builder.Services.AddSingleton(new PendingStartStore(dataDir));
builder.Services.AddSingleton(new ExtensionInstallService(dataDir));
builder.Services.AddSingleton(new ExtensionPresenceStore(dataDir));
builder.Services.AddSingleton(new ChatSessionStore(dataDir));
builder.Services.AddSingleton(new UiPreferenceStore(dataDir));
builder.Services.AddSingleton(new AuditLogService(dataDir));
builder.Services.AddSingleton<ITool, ProjectInfoTool>();
builder.Services.AddSingleton<ITool, ListFilesTool>();
builder.Services.AddSingleton<ITool, FindFilesTool>();
builder.Services.AddSingleton<ITool, DirectorySummaryTool>();
builder.Services.AddSingleton<ITool, SearchTextTool>();
builder.Services.AddSingleton<ITool, ReadFileTool>();
builder.Services.AddSingleton<ToolRegistry>(sp =>
    new ToolRegistry(sp.GetServices<ITool>(), sp.GetRequiredService<ApprovedRootRegistry>(), limits));

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddFixedWindowLimiter("api", o =>
    {
        o.PermitLimit = 60;
        o.Window = TimeSpan.FromMinutes(1);
        o.QueueLimit = 0;
    });
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("bridge", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
            {
                if (string.IsNullOrEmpty(origin)) return false;
                if (origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase)) return true;
                if (origin.Equals("http://127.0.0.1:32178", StringComparison.OrdinalIgnoreCase)) return true;
                if (origin.Equals("http://localhost:32178", StringComparison.OrdinalIgnoreCase)) return true;
                return false;
            })
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();
app.UseRateLimiter();
app.UseCors("bridge");

// Prefer files next to the published DLL (AppContext.BaseDirectory). ContentRoot is often
// the process cwd (e.g. repo root when launched via scripts), which may not contain wwwroot.
static string? ResolveMockChatDirectory(string contentRoot)
{
    var candidates = new[]
    {
        Path.Combine(AppContext.BaseDirectory, "wwwroot", "mock-chat"),
        Path.Combine(contentRoot, "wwwroot", "mock-chat"),
        Path.Combine(contentRoot, "mock-chat"),
        Path.GetFullPath(Path.Combine(contentRoot, "..", "..", "..", "mock-chat")),
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "mock-chat")),
    };
    foreach (var candidate in candidates)
    {
        if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "index.html")))
            return Path.GetFullPath(candidate);
    }
    return null;
}

var mockChatPath = ResolveMockChatDirectory(app.Environment.ContentRootPath);
if (mockChatPath is not null)
{
    var mockFiles = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(mockChatPath);
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = mockFiles,
        RequestPath = "/mock-chat"
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = mockFiles,
        RequestPath = "/mock-chat"
    });
    // Single route — registering both /mock-chat and /mock-chat/ is ambiguous in ASP.NET.
    var indexHtml = File.ReadAllText(Path.Combine(mockChatPath, "index.html"));
    app.MapGet("/mock-chat/{*rest}", (string? rest) =>
    {
        if (string.IsNullOrEmpty(rest) || rest is "index.html")
            return Results.Content(indexHtml, "text/html; charset=utf-8");
        return Results.NotFound();
    });
}

static string? ResolveBridgeUiDirectory(string contentRoot)
{
    var candidates = new[]
    {
        Path.Combine(AppContext.BaseDirectory, "wwwroot", "bridge"),
        Path.Combine(contentRoot, "wwwroot", "bridge"),
        Path.GetFullPath(Path.Combine(contentRoot, "..", "..", "..", "src", "LocalContextBridge.Api", "wwwroot", "bridge")),
    };
    foreach (var candidate in candidates)
    {
        if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "setup.html")))
            return Path.GetFullPath(candidate);
    }
    return null;
}

var bridgeUiPath = ResolveBridgeUiDirectory(app.Environment.ContentRootPath);
if (bridgeUiPath is not null)
{
    var bridgeFiles = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(bridgeUiPath);
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = bridgeFiles,
        RequestPath = "/bridge"
    });
}

app.MapGet("/health", () => Results.Json(new
{
    status = "ok",
    version,
    docker = isDocker,
    time = DateTimeOffset.UtcNow
}));

app.MapPost("/pairing/request", async (HttpRequest req, PairingService pairing, AuditLogService audit) =>
{
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var installationId = doc.RootElement.GetProperty("installationId").GetString() ?? "";
    var extensionOrigin = doc.RootElement.TryGetProperty("extensionOrigin", out var o)
        ? o.GetString() ?? ""
        : req.Headers.Origin.ToString();
    try
    {
        var state = pairing.Request(installationId, extensionOrigin);
        audit.Add("pairing", "pairing_requested", true, state.Id);
        return Results.Json(new
        {
            id = state.Id,
            expiresAt = state.ExpiresAt,
            message = "Approve this request in the local management UI."
        });
    }
    catch (Exception ex)
    {
        return SafeError(400, "pairing_request_failed", ex.Message);
    }
});

app.MapGet("/pairing/status/{id}", (string id, PairingService pairing) =>
{
    var s = pairing.GetStatus(id);
    if (s is null) return SafeError(404, "not_found", "Pairing request not found.");
    return Results.Json(new
    {
        id = s.Id,
        approved = s.Approved,
        redeemed = s.Redeemed,
        expiresAt = s.ExpiresAt
    });
});

app.MapPost("/pairing/redeem", async (HttpRequest req, PairingService pairing, AuditLogService audit) =>
{
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var id = doc.RootElement.GetProperty("id").GetString() ?? "";
    var installationId = doc.RootElement.GetProperty("installationId").GetString() ?? "";
    var extensionOrigin = doc.RootElement.TryGetProperty("extensionOrigin", out var o)
        ? o.GetString() ?? ""
        : req.Headers.Origin.ToString();
    var token = pairing.Redeem(id, installationId, extensionOrigin);
    if (token is null) return SafeError(400, "redeem_failed", "Pairing could not be redeemed.");
    audit.Add("pairing", "pairing_redeemed", true, id);
    return Results.Json(new { token });
});

app.MapGet("/api/v1/status", (HttpRequest req, PairingService pairing, ApprovedRootRegistry roots, PreferenceStore prefs) =>
{
    if (!Authorize(req, pairing, out var err)) return err!;
    var primary = roots.GetPrimary();
    var homePath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    return Results.Json(new
    {
        paired = pairing.IsPaired(),
        version,
        docker = isDocker,
        primaryAlias = primary?.Alias,
        homePath,
        defaultMode = prefs.DefaultMode,
        roots = roots.GetAll().Select(r => new
        {
            id = r.Id,
            alias = r.Alias,
            path = r.AbsolutePath,
            primary = r.IsPrimary,
            accessPolicy = r.AccessPolicy.ToString(),
            persistence = r.Persistence.ToString()
        })
    });
}).RequireRateLimiting("api");

app.MapPost("/api/v1/roots", async (HttpRequest req, PairingService pairing, ApprovedRootRegistry roots, AuditLogService audit) =>
{
    if (!Authorize(req, pairing, out var err)) return err!;
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var scope = doc.RootElement.TryGetProperty("scope", out var sc) ? sc.GetString() ?? "project" : "project";
    var alias = doc.RootElement.TryGetProperty("alias", out var a) ? a.GetString() ?? "" : "";
    var primary = !doc.RootElement.TryGetProperty("primary", out var pr) || pr.GetBoolean();

    string path;
    if (string.Equals(scope, "home", StringComparison.OrdinalIgnoreCase))
    {
        path = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(alias)) alias = "home";
    }
    else
    {
        path = doc.RootElement.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(alias)) alias = "project";
    }

    if (string.IsNullOrWhiteSpace(path))
        return SafeError(400, "missing_path", "A project folder path is required.");

    try
    {
        path = ExpandUserPath(path);
        var full = Path.GetFullPath(path);
        if (IsFilesystemRoot(full) && !string.Equals(scope, "home", StringComparison.OrdinalIgnoreCase))
            return SafeError(400, "path_too_broad", "Approving the entire filesystem root is not allowed. Choose a project folder or use home-folder scope.");
        if (!Directory.Exists(full))
            return SafeError(400, "register_failed", $"Directory does not exist: {full}");
        var root = roots.Upsert(full, alias.Trim(), primary);
        audit.Add("roots", $"registered:{root.Alias}:scope={scope}", true, rootAlias: root.Alias);
        return Results.Json(new
        {
            id = root.Id,
            alias = root.Alias,
            path = root.AbsolutePath,
            primary = root.IsPrimary,
            scope
        });
    }
    catch (Exception ex)
    {
        return SafeError(400, "register_failed", ex.Message);
    }
}).RequireRateLimiting("api");

app.MapDelete("/api/v1/roots/{id}", (string id, HttpRequest req, PairingService pairing, ApprovedRootRegistry roots, AuditLogService audit) =>
{
    if (!Authorize(req, pairing, out var err)) return err!;
    if (!roots.Remove(id)) return SafeError(404, "not_found", "Root not found.");
    audit.Add("roots", $"removed:{id}", true);
    return Results.Json(new { removed = true });
}).RequireRateLimiting("api");

app.MapPost("/api/v1/tools/execute", async (HttpRequest req, PairingService pairing, ReplayProtectionService replay, ToolRegistry tools, AuditLogService audit, BridgeLimits lim) =>
{
    var correlationId = Guid.NewGuid().ToString("N");
    if (!Authorize(req, pairing, out var err)) return err!;

    if (!req.Headers.TryGetValue("X-Bridge-Nonce", out var nonce) || string.IsNullOrWhiteSpace(nonce))
        return SafeError(400, "missing_nonce", "X-Bridge-Nonce required.", correlationId);
    if (!req.Headers.TryGetValue("X-Bridge-Timestamp", out var tsRaw) || !DateTimeOffset.TryParse(tsRaw, out var ts))
        return SafeError(400, "missing_timestamp", "X-Bridge-Timestamp required.", correlationId);

    using var ms = new MemoryStream();
    await req.Body.CopyToAsync(ms);
    if (ms.Length > lim.MaxRequestBytes)
        return SafeError(413, "request_too_large", "Request exceeds limit.", correlationId);
    var bodyText = Encoding.UTF8.GetString(ms.ToArray());

    LocalToolRequest? toolReq;
    try
    {
        toolReq = JsonSerializer.Deserialize<LocalToolRequest>(bodyText, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }
    catch
    {
        return SafeError(400, "invalid_json", "Malformed JSON.", correlationId);
    }

    if (toolReq is null || toolReq.Type != "LOCAL_TOOL_REQUEST" || toolReq.ProtocolVersion != "1.0" ||
        string.IsNullOrWhiteSpace(toolReq.Id) || string.IsNullOrWhiteSpace(toolReq.Tool))
        return SafeError(400, "invalid_request", "Invalid tool request.", correlationId);

    var hash = ReplayProtectionService.Sha256Hex(bodyText);
    if (!replay.TryAccept(nonce.ToString(), toolReq.Id, hash, ts, lim.TimestampSkewSeconds, out var replayErr))
        return SafeError(409, replayErr, "Replay or duplicate detected.", correlationId);

    var result = await tools.ExecuteAsync(toolReq, req.HttpContext.RequestAborted);
    if (result.Error is not null) result.Error.CorrelationId = correlationId;
    audit.Add("tool", $"{toolReq.Tool}:{(result.Success ? "ok" : result.Error?.Code)}", result.Success, correlationId, toolReq.Tool,
        ToolRegistry.GetString(toolReq.Arguments, "rootAlias"));
    return Results.Json(result);
}).RequireRateLimiting("api");

app.MapPost("/api/v1/session/stop", (HttpRequest req, PairingService pairing, ApprovedRootRegistry roots, AuditLogService audit) =>
{
    if (!Authorize(req, pairing, out var err)) return err!;
    roots.ClearSessionOnly();
    audit.Add("session", "session_stop", true);
    return Results.Json(new { stopped = true });
}).RequireRateLimiting("api");

app.MapPost("/api/v1/local/pick-folder", (HttpRequest req) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Only loopback may open the folder picker.");
    var path = NativeFolderPicker.PickFolder();
    if (string.IsNullOrWhiteSpace(path))
        return SafeError(400, "cancelled", "No folder was selected.");
    return Results.Json(new { path });
});

app.MapPost("/api/v1/roots/pick-folder", (HttpRequest req, PairingService pairing) =>
{
    if (!Authorize(req, pairing, out var err)) return err!;
    var path = NativeFolderPicker.PickFolder();
    if (string.IsNullOrWhiteSpace(path))
        return SafeError(400, "cancelled", "No folder was selected.");
    return Results.Json(new { path });
}).RequireRateLimiting("api");

app.MapPost("/api/v1/local/register-root", async (HttpRequest req, ApprovedRootRegistry roots, AuditLogService audit) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Only loopback may register roots.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var path = ExpandUserPath(doc.RootElement.GetProperty("path").GetString() ?? "");
    var alias = doc.RootElement.TryGetProperty("alias", out var a) ? a.GetString() ?? "project" : "project";
    var primary = !doc.RootElement.TryGetProperty("primary", out var pr) || pr.GetBoolean();
    try
    {
        var root = roots.Upsert(path, alias, primary);
        audit.Add("roots", $"registered:{root.Alias}", true, rootAlias: root.Alias);
        return Results.Json(new { id = root.Id, alias = root.Alias, path = root.AbsolutePath, primary = root.IsPrimary });
    }
    catch (Exception ex)
    {
        return SafeError(400, "register_failed", ex.Message);
    }
});

app.MapPost("/api/v1/local/auto-pair", async (HttpRequest req, PairingService pairing, AuditLogService audit) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Only loopback may auto-pair.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var installationId = doc.RootElement.TryGetProperty("installationId", out var iid) ? iid.GetString() ?? "" : "";
    var extensionOrigin = doc.RootElement.TryGetProperty("extensionOrigin", out var o)
        ? o.GetString() ?? ""
        : req.Headers.Origin.ToString();
    try
    {
        var token = pairing.AutoPair(installationId, extensionOrigin);
        audit.Add("pairing", "auto_paired", true, installationId);
        return Results.Json(new { token, extensionOrigin = extensionOrigin.TrimEnd('/') });
    }
    catch (Exception ex)
    {
        return SafeError(400, "auto_pair_failed", ex.Message);
    }
});

app.MapGet("/api/v1/local/preferences", (HttpRequest req, PreferenceStore prefs) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    return Results.Json(prefs.Snapshot());
});

app.MapPost("/api/v1/local/preferences", async (HttpRequest req, PreferenceStore prefs) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    if (doc.RootElement.TryGetProperty("defaultMode", out var m) && m.GetString() is { } mode)
        prefs.SetDefaultMode(mode);
    return Results.Json(prefs.Snapshot());
});

app.MapPost("/api/v1/local/pending-start", async (HttpRequest req, PendingStartStore pending, PreferenceStore prefs, ApprovedRootRegistry roots, ChatSessionStore sessions) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var mode = doc.RootElement.TryGetProperty("mode", out var mo) ? mo.GetString() : prefs.DefaultMode;
    var rootAlias = doc.RootElement.TryGetProperty("rootAlias", out var ra)
        ? ra.GetString()
        : roots.GetPrimary()?.Alias;
    var explore = !doc.RootElement.TryGetProperty("explore", out var ex) || ex.ValueKind != JsonValueKind.False;
    var initialTask = doc.RootElement.TryGetProperty("initialTask", out var it) ? it.GetString() : null;
    var recorded = RecordBridgeSession(sessions, mode, rootAlias);
    pending.Set(mode, rootAlias, initialTask, explore, recorded.ChatId, recorded.Title);
    return Results.Json(new { ok = true, mode, rootAlias, explore, sessionId = recorded.ChatId, expiresInSeconds = 120 });
});

app.MapPost("/api/v1/local/pending-start/consume", (HttpRequest req, PendingStartStore pending) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    var p = pending.Consume();
    if (p is null) return Results.Json(new { pending = false });
    return Results.Json(new
    {
        pending = true,
        mode = p.Mode,
        rootAlias = p.RootAlias,
        initialTask = p.InitialTask,
        explore = p.Explore,
        sessionId = p.SessionId,
        title = p.Title,
        createdAt = p.CreatedAt,
        expiresAt = p.ExpiresAt
    });
});

app.MapGet("/api/v1/local/pending-start", (HttpRequest req, PendingStartStore pending) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    var p = pending.Peek();
    if (p is null) return Results.Json(new { pending = false });
    return Results.Json(new
    {
        pending = true,
        mode = p.Mode,
        rootAlias = p.RootAlias,
        initialTask = p.InitialTask,
        explore = p.Explore,
        sessionId = p.SessionId,
        title = p.Title,
        expiresAt = p.ExpiresAt
    });
});

app.MapPost("/api/v1/local/start-in-copilot", async (HttpRequest req, PendingStartStore pending, PreferenceStore prefs, ApprovedRootRegistry roots, ChatSessionStore sessions) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var mode = doc.RootElement.TryGetProperty("mode", out var mo) ? mo.GetString() : prefs.DefaultMode;
    var rootAlias = doc.RootElement.TryGetProperty("rootAlias", out var ra)
        ? ra.GetString()
        : roots.GetPrimary()?.Alias;
    if (string.IsNullOrWhiteSpace(rootAlias) && roots.GetPrimary() is null)
        return SafeError(400, "no_folder", "Choose a project folder before starting.");

    var recorded = RecordBridgeSession(sessions, mode, rootAlias);
    pending.Set(mode, rootAlias, initialTask: null, explore: true, recorded.ChatId, recorded.Title);

    // Unique query forces Chrome to navigate/reload so the extension content script wakes
    // and can consume the pending start (focusing an existing Copilot tab is not enough).
    var copilotUrl =
        "https://m365.cloud.microsoft/chat/?lcb_start=" +
        Uri.EscapeDataString(recorded.ChatId) +
        "&t=" +
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    if (OperatingSystem.IsMacOS())
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "open",
                ArgumentList = { "-a", "Google Chrome", copilotUrl },
                UseShellExecute = false
            });
        }
        catch
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "open",
                ArgumentList = { copilotUrl },
                UseShellExecute = false
            });
        }
    }

    return Results.Json(new
    {
        ok = true,
        mode,
        rootAlias,
        sessionId = recorded.ChatId,
        title = recorded.Title,
        url = copilotUrl,
        message = "Copilot opening — extension will paste and send the bootstrap message."
    });
});

app.MapGet("/api/v1/local/extension-status", (HttpRequest req, ExtensionInstallService extInstall, ExtensionPresenceStore presence) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    var fromChrome = extInstall.IsInstalled();
    var fromHeartbeat = presence.IsPresent();
    return Results.Json(new
    {
        extensionId = ExtensionInstallService.PinnedExtensionId,
        installed = fromChrome || fromHeartbeat,
        fromChrome,
        fromHeartbeat,
        presence = presence.Snapshot()
    });
});

app.MapPost("/api/v1/local/extension-heartbeat", async (HttpRequest req, ExtensionPresenceStore presence) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var installationId = doc.RootElement.TryGetProperty("installationId", out var iid) ? iid.GetString() : null;
    var extensionOrigin = doc.RootElement.TryGetProperty("extensionOrigin", out var o)
        ? o.GetString()
        : req.Headers.Origin.ToString();
    presence.Heartbeat(installationId, extensionOrigin);
    return Results.Json(presence.Snapshot());
});

app.MapGet("/api/v1/local/ui-preferences", (HttpRequest req, UiPreferenceStore ui) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    return Results.Json(new { theme = ui.Theme });
});

app.MapPost("/api/v1/local/ui-preferences", async (HttpRequest req, UiPreferenceStore ui) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    if (doc.RootElement.TryGetProperty("theme", out var th) && th.GetString() is { } theme)
        ui.SetTheme(theme);
    return Results.Json(new { theme = ui.Theme });
});

app.MapGet("/api/v1/local/chat-sessions", (HttpRequest req, ChatSessionStore sessions) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    return Results.Json(sessions.List().Select(s => new
    {
        chatId = s.ChatId,
        title = s.Title,
        projectAlias = s.ProjectAlias,
        mode = s.Mode,
        copilotUrl = ChatSessionStore.ResolveOpenUrl(s) ?? s.CopilotUrl,
        resumable = ChatSessionStore.ResolveOpenUrl(s) is not null,
        rootAliases = s.RootAliases,
        createdAt = s.CreatedAt,
        lastActiveAt = s.LastActiveAt
    }));
});

app.MapGet("/api/v1/local/chat-sessions/{chatId}", (string chatId, HttpRequest req, ChatSessionStore sessions) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    var s = sessions.Get(chatId);
    if (s is null) return SafeError(404, "not_found", "Session not found.");
    var openUrl = ChatSessionStore.ResolveOpenUrl(s) ?? s.CopilotUrl;
    return Results.Json(new
    {
        chatId = s.ChatId,
        title = s.Title,
        projectAlias = s.ProjectAlias,
        mode = s.Mode,
        copilotUrl = openUrl,
        resumable = openUrl is not null,
        rootAliases = s.RootAliases,
        createdAt = s.CreatedAt,
        lastActiveAt = s.LastActiveAt
    });
});

app.MapPost("/api/v1/local/chat-sessions", async (HttpRequest req, ChatSessionStore sessions) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var record = new ChatSessionRecord
    {
        ChatId = doc.RootElement.TryGetProperty("chatId", out var id) ? id.GetString() ?? "" : "",
        Title = doc.RootElement.TryGetProperty("title", out var title) ? title.GetString() ?? "" : "",
        ProjectAlias = doc.RootElement.TryGetProperty("projectAlias", out var pa) ? pa.GetString() ?? "" : "",
        Mode = doc.RootElement.TryGetProperty("mode", out var mode) ? mode.GetString() ?? "assisted" : "assisted",
        CopilotUrl = doc.RootElement.TryGetProperty("copilotUrl", out var url) ? url.GetString() : null,
        RootAliases = doc.RootElement.TryGetProperty("rootAliases", out var roots) && roots.ValueKind == JsonValueKind.Array
            ? roots.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToList()
            : new List<string>()
    };
    if (string.IsNullOrWhiteSpace(record.ChatId))
        return SafeError(400, "missing_chat_id", "chatId is required.");
    return Results.Json(sessions.Upsert(record));
});

app.MapDelete("/api/v1/local/chat-sessions/{chatId}", (string chatId, HttpRequest req, ChatSessionStore sessions) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    return sessions.Remove(chatId) ? Results.Json(new { removed = true }) : SafeError(404, "not_found", "Session not found.");
});

app.MapPost("/api/v1/local/chat-sessions/remap", async (HttpRequest req, ChatSessionStore sessions) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var fromId = doc.RootElement.TryGetProperty("fromChatId", out var f) ? f.GetString() ?? "" : "";
    var toId = doc.RootElement.TryGetProperty("toChatId", out var t) ? t.GetString() ?? "" : "";
    var remapped = sessions.RemapChatId(fromId, toId);
    return remapped is null
        ? SafeError(404, "not_found", "Session not found.")
        : Results.Json(remapped);
});

app.MapGet("/api/v1/local/setup-state", (HttpRequest req, ApprovedRootRegistry roots, PreferenceStore prefs, PairingService pairing, ExtensionInstallService extInstall, ExtensionPresenceStore presence, UiPreferenceStore ui) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    var primary = roots.GetPrimary();
    var homePath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    var extensionInstalled = extInstall.IsInstalled() || presence.IsPresent();
    return Results.Json(new
    {
        paired = pairing.IsPaired(),
        defaultMode = prefs.DefaultMode,
        theme = ui.Theme,
        homePath,
        primaryAlias = primary?.Alias,
        primaryPath = primary?.AbsolutePath,
        extensionId = ExtensionInstallService.PinnedExtensionId,
        extensionInstalled,
        ready = extensionInstalled && primary is not null,
        roots = roots.GetAll().Select(r => new
        {
            id = r.Id,
            alias = r.Alias,
            path = r.AbsolutePath,
            primary = r.IsPrimary
        })
    });
});

app.MapPost("/api/v1/local/install-extension", (HttpRequest req, ExtensionInstallService extInstall, AuditLogService audit) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    var result = extInstall.Install(version: version);
    audit.Add("extension", result.AlreadyPresent ? "already_installed" : (result.Installed ? "installed" : "install_queued"), true);
    return Results.Json(new
    {
        installed = result.Installed || result.AlreadyPresent,
        alreadyPresent = result.AlreadyPresent,
        message = result.Message,
        extensionId = ExtensionInstallService.PinnedExtensionId,
        crxPath = result.CrxPath
    });
});

app.MapPost("/api/v1/local/open-extensions-page", (HttpRequest req, ExtensionInstallService extInstall) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    extInstall.OpenChromeExtensionsPage();
    return Results.Json(new { ok = true });
});

app.MapPost("/api/v1/local/reveal-extension-folder", (HttpRequest req, ExtensionInstallService extInstall) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    extInstall.RevealExtensionFolder();
    return Results.Json(new { ok = true });
});

app.MapPost("/api/v1/local/pairing/approve", async (HttpRequest req, PairingService pairing) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    using var doc = await JsonDocument.ParseAsync(req.Body);
    var id = doc.RootElement.GetProperty("id").GetString() ?? "";
    return pairing.Approve(id) ? Results.Json(new { approved = true }) : SafeError(400, "approve_failed", "Could not approve.");
});

app.MapPost("/api/v1/local/pairing/revoke", (HttpRequest req, PairingService pairing, AuditLogService audit) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    pairing.RevokeAll();
    audit.Add("pairing", "revoked_all", true);
    return Results.Json(new { revoked = true });
});

app.MapGet("/api/v1/local/audit", (HttpRequest req, AuditLogService audit) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    return Results.Json(audit.List());
});

app.MapPost("/api/v1/local/audit/clear", (HttpRequest req, AuditLogService audit) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    audit.Clear();
    return Results.Json(new { cleared = true });
});

app.MapDelete("/api/v1/local/roots/{id}", (string id, HttpRequest req, ApprovedRootRegistry roots) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    return roots.Remove(id) ? Results.Json(new { removed = true }) : SafeError(404, "not_found", "Root not found.");
});

app.MapGet("/api/v1/local/roots", (HttpRequest req, ApprovedRootRegistry roots) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    return Results.Json(roots.GetAll().Select(r => new
    {
        id = r.Id,
        alias = r.Alias,
        path = r.AbsolutePath,
        primary = r.IsPrimary,
        accessPolicy = r.AccessPolicy.ToString(),
        persistence = r.Persistence.ToString()
    }));
});

app.MapPost("/api/v1/local/test-tool", async (HttpRequest req, ToolRegistry tools, ApprovedRootRegistry roots) =>
{
    if (!IsLoopback(req)) return SafeError(403, "loopback_only", "Loopback only.");
    var primary = roots.GetPrimary();
    if (primary is null) return SafeError(400, "no_root", "No primary root.");
    var toolReq = new LocalToolRequest
    {
        Id = "local-test-" + Guid.NewGuid().ToString("N"),
        Tool = "project_info",
        Arguments = new Dictionary<string, object?> { ["rootAlias"] = primary.Alias }
    };
    var result = await tools.ExecuteAsync(toolReq, req.HttpContext.RequestAborted);
    return Results.Json(result);
});

app.MapGet("/local", (PairingService pairing, ApprovedRootRegistry roots) =>
{
    var html = LocalUi.Render(version, isDocker, pairing, roots);
    return Results.Content(html, "text/html; charset=utf-8");
});

app.MapGet("/setup", () =>
{
    var dir = ResolveBridgeUiDirectory(app.Environment.ContentRootPath) ?? bridgeUiPath;
    if (dir is null) return Results.NotFound();
    var html = File.ReadAllText(Path.Combine(dir, "setup.html"));
    return Results.Content(html, "text/html; charset=utf-8");
});

app.MapGet("/app", () =>
{
    var dir = ResolveBridgeUiDirectory(app.Environment.ContentRootPath) ?? bridgeUiPath;
    if (dir is null) return Results.NotFound();
    var html = File.ReadAllText(Path.Combine(dir, "app.html"));
    return Results.Content(html, "text/html; charset=utf-8");
});

app.MapGet("/", () => Results.Redirect("/app"));

app.Run();

static ChatSessionRecord RecordBridgeSession(ChatSessionStore sessions, string? mode, string? rootAlias)
{
    var alias = string.IsNullOrWhiteSpace(rootAlias) ? "project" : rootAlias.Trim();
    var now = DateTimeOffset.UtcNow;
    var title = $"{SanitizeAlias(alias)}-{now:yyyy-MM-dd_HHmm}";
    var chatId = "bridge-" + Guid.NewGuid().ToString("N");
    return sessions.Upsert(new ChatSessionRecord
    {
        ChatId = chatId,
        Title = title,
        ProjectAlias = alias,
        Mode = string.IsNullOrWhiteSpace(mode) ? "assisted" : mode.Trim().ToLowerInvariant(),
        CopilotUrl = null,
        RootAliases = new List<string> { alias }
    });
}

static string SanitizeAlias(string value)
{
    var cleaned = new string(value.Select(ch =>
        char.IsLetterOrDigit(ch) || ch is '.' or '_' or '-' ? ch : '-').ToArray());
    return cleaned.Trim('-').Length > 0 ? cleaned.Trim('-') : "project";
}

static bool IsLoopback(HttpRequest req)
{
    var conn = req.HttpContext.Connection.RemoteIpAddress;
    return conn is not null && System.Net.IPAddress.IsLoopback(conn);
}

/** Expand leading ~ to the current user profile (common when pasting paths). */
static string ExpandUserPath(string path)
{
    if (string.IsNullOrWhiteSpace(path)) return path;
    var trimmed = path.Trim();
    if (trimmed == "~")
        return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    if (trimmed.StartsWith("~/") || trimmed.StartsWith("~\\"))
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return Path.Combine(home, trimmed[2..].Replace('\\', Path.DirectorySeparatorChar));
    }
    return trimmed;
}

/** True for `/`, `C:\`, etc. — too broad for a normal project approval. */
static bool IsFilesystemRoot(string fullPath)
{
    try
    {
        var full = Path.GetFullPath(fullPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var root = Path.GetPathRoot(full)?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return !string.IsNullOrEmpty(root) &&
               string.Equals(full, root, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    }
    catch
    {
        return true;
    }
}

static bool Authorize(HttpRequest req, PairingService pairing, out IResult? error)
{
    error = null;
    var auth = req.Headers.Authorization.ToString();
    if (string.IsNullOrEmpty(auth) || !auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        error = SafeError(401, "unauthorized", "Bearer token required.");
        return false;
    }
    var token = auth["Bearer ".Length..].Trim();
    var origin = req.Headers.Origin.ToString();
    if (string.IsNullOrEmpty(origin)) origin = req.Headers.Referer.ToString();
    if (!pairing.ValidateToken(token, string.IsNullOrEmpty(origin) ? null : origin))
    {
        error = SafeError(401, "unauthorized", "Invalid token or origin.");
        return false;
    }
    return true;
}

static IResult SafeError(int status, string code, string message, string? correlationId = null)
{
    correlationId ??= Guid.NewGuid().ToString("N");
    return Results.Json(new
    {
        error = new { code, message, correlationId }
    }, statusCode: status);
}

public partial class Program { }

internal static class LocalUi
{
    public static string Render(string version, bool docker, PairingService pairing, ApprovedRootRegistry roots)
    {
        var pending = pairing.ListPending();
        var rootsJson = JsonSerializer.Serialize(roots.GetAll().Select(r => new
        {
            r.Id, r.Alias, path = r.AbsolutePath, r.IsPrimary, policy = r.AccessPolicy.ToString()
        }));
        var pendingJson = JsonSerializer.Serialize(pending.Select(p => new
        {
            p.Id, p.ExtensionOrigin, p.OneTimeCode, p.Approved, p.ExpiresAt
        }));

        return $$"""
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Local Context Bridge</title>
<style>
:root { --bg:#0f1419; --panel:#1a2332; --text:#e7ecf3; --muted:#9aa7b8; --accent:#3d9cf0; --warn:#e0a106; --ok:#3ecf8e; }
*{box-sizing:border-box} body{margin:0;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;background:radial-gradient(1200px 600px at 10% -10%,#1c2a40,var(--bg));color:var(--text)}
main{max-width:960px;margin:0 auto;padding:32px 20px 64px} h1{font-size:28px;margin:0 0 8px} .muted{color:var(--muted)}
.grid{display:grid;gap:16px;margin-top:24px} section{background:var(--panel);border:1px solid #2a3548;border-radius:12px;padding:16px 18px}
h2{font-size:15px;margin:0 0 12px;letter-spacing:.02em;text-transform:uppercase;color:var(--muted)}
button,.btn{background:var(--accent);color:#041018;border:0;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer}
button.secondary{background:#2a3548;color:var(--text)} button.danger{background:#b33a3a;color:#fff}
input,select{width:100%;padding:8px 10px;border-radius:8px;border:1px solid #2a3548;background:#0f1722;color:var(--text);margin:6px 0 12px}
table{width:100%;border-collapse:collapse} td,th{text-align:left;padding:6px 4px;border-bottom:1px solid #2a3548;font-size:13px}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#243044;font-size:12px}
.ok{color:var(--ok)} .warn{color:var(--warn)} pre{white-space:pre-wrap;background:#0f1722;padding:10px;border-radius:8px;max-height:240px;overflow:auto}
.banner{border:1px solid #5a4a12;background:#2a230c;color:#f0d78c;padding:10px 12px;border-radius:8px;margin:16px 0}
</style>
</head>
<body>
<main>
  <h1>Local Context Bridge</h1>
  <p class="muted">Version {{version}} · {{(docker ? "Docker" : "Native")}} · Loopback management UI</p>
  <div class="banner">Corporate policy: this tool is read-only. Absolute paths stay on this page only — never in Copilot.</div>
  <div class="grid">
    <section>
      <h2>Service</h2>
      <p>Health: <span class="ok" id="health">checking…</span> · Paired: <span id="paired">{{(pairing.IsPaired() ? "yes" : "no")}}</span></p>
      <p class="muted">Extension: chrome://extensions → Load unpacked → extension/dist</p>
      <p><a class="btn" href="/mock-chat/" style="text-decoration:none;display:inline-block">Open mock chat</a></p>
    </section>
    <section>
      <h2>Pending pairing</h2>
      <div id="pending"></div>
      <button class="danger" id="revoke">Revoke all tokens</button>
    </section>
    <section>
      <h2>Approved roots</h2>
      <label>Absolute folder path</label>
      <input id="rootPath" placeholder="/absolute/path/to/project"/>
      <label>Alias</label>
      <input id="rootAlias" placeholder="billing-service" value="project"/>
      <button id="addRoot">Add / update root (primary)</button>
      <div id="roots" style="margin-top:12px"></div>
    </section>
    <section>
      <h2>Activity</h2>
      <button class="secondary" id="refreshAudit">Refresh</button>
      <button class="secondary" id="clearAudit">Clear logs</button>
      <button class="secondary" id="testTool">Test read-only tool</button>
      <pre id="audit"></pre>
    </section>
  </div>
</main>
<script>
const roots = {{rootsJson}};
const pending = {{pendingJson}};
async function refreshHealth(){
  try{ const r=await fetch('/health'); const j=await r.json(); document.getElementById('health').textContent=j.status+' @ '+j.version; }
  catch{ document.getElementById('health').textContent='offline'; document.getElementById('health').className='warn'; }
}
function renderRoots(){
  const el=document.getElementById('roots');
  el.innerHTML = '<table><tr><th>Alias</th><th>Path</th><th>Primary</th><th></th></tr>' +
    roots.map(r=>`<tr><td>${r.Alias}</td><td><code>${r.path}</code></td><td>${r.IsPrimary?'yes':''}</td>
    <td><button class="secondary" data-del="${r.Id}">Remove</button></td></tr>`).join('') + '</table>';
  el.querySelectorAll('[data-del]').forEach(btn=>btn.onclick=async()=>{
    await fetch('/api/v1/local/roots/'+btn.dataset.del,{method:'DELETE'}); location.reload();
  });
}
function renderPending(){
  const el=document.getElementById('pending');
  if(!pending.length){ el.innerHTML='<p class="muted">No pending requests.</p>'; return; }
  el.innerHTML = pending.map(p=>`<div style="margin-bottom:10px">
    <div><span class="pill">${p.Id.slice(0,8)}</span> ${p.ExtensionOrigin} · code <code>${p.OneTimeCode}</code> · ${p.Approved?'approved':'awaiting'}</div>
    ${p.Approved?'':`<button data-approve="${p.Id}">Approve</button>`}
  </div>`).join('');
  el.querySelectorAll('[data-approve]').forEach(btn=>btn.onclick=async()=>{
    await fetch('/api/v1/local/pairing/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:btn.dataset.approve})});
    location.reload();
  });
}
document.getElementById('addRoot').onclick=async()=>{
  const path=document.getElementById('rootPath').value.trim();
  const alias=document.getElementById('rootAlias').value.trim()||'project';
  const r=await fetch('/api/v1/local/register-root',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,alias,primary:true})});
  if(!r.ok){ alert('Failed'); return;} location.reload();
};
document.getElementById('revoke').onclick=async()=>{
  if(!confirm('Revoke all paired tokens?'))return;
  await fetch('/api/v1/local/pairing/revoke',{method:'POST'}); location.reload();
};
async function loadAudit(){
  const r=await fetch('/api/v1/local/audit'); const j=await r.json();
  document.getElementById('audit').textContent=j.map(e=>`${e.Timestamp} [${e.Category}] ${e.Message}`).join('\n')||'(empty)';
}
document.getElementById('refreshAudit').onclick=loadAudit;
document.getElementById('clearAudit').onclick=async()=>{ await fetch('/api/v1/local/audit/clear',{method:'POST'}); loadAudit(); };
document.getElementById('testTool').onclick=async()=>{
  const r=await fetch('/api/v1/local/test-tool',{method:'POST'}); const j=await r.json();
  document.getElementById('audit').textContent=JSON.stringify(j,null,2);
};
refreshHealth(); renderRoots(); renderPending(); loadAudit();
</script>
</body>
</html>
""";
    }
}

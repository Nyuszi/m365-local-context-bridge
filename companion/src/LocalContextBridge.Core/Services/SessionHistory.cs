using System.Text.Json;

namespace LocalContextBridge.Core.Services;

/// <summary>Tracks whether the Chrome extension has checked in recently (Load unpacked or Store).</summary>
public sealed class ExtensionPresenceStore
{
    private readonly object _gate = new();
    private readonly string _storePath;
    private DateTimeOffset? _lastSeenAt;
    private string? _extensionOrigin;
    private string? _installationId;

    public ExtensionPresenceStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _storePath = Path.Combine(dataDirectory, "extension-presence.json");
        Load();
    }

    public void Heartbeat(string? installationId, string? extensionOrigin)
    {
        lock (_gate)
        {
            _lastSeenAt = DateTimeOffset.UtcNow;
            if (!string.IsNullOrWhiteSpace(installationId)) _installationId = installationId;
            if (!string.IsNullOrWhiteSpace(extensionOrigin)) _extensionOrigin = extensionOrigin.TrimEnd('/');
            Save_NoLock();
        }
    }

    public bool IsPresent(TimeSpan? maxAge = null)
    {
        var age = maxAge ?? TimeSpan.FromMinutes(15);
        lock (_gate)
        {
            if (_lastSeenAt is null) return false;
            return DateTimeOffset.UtcNow - _lastSeenAt.Value <= age;
        }
    }

    public object Snapshot()
    {
        lock (_gate)
        {
            return new
            {
                present = _lastSeenAt is not null && DateTimeOffset.UtcNow - _lastSeenAt.Value <= TimeSpan.FromMinutes(15),
                lastSeenAt = _lastSeenAt,
                installationId = _installationId,
                extensionOrigin = _extensionOrigin
            };
        }
    }

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(_storePath));
            if (doc.RootElement.TryGetProperty("lastSeenAt", out var t) &&
                DateTimeOffset.TryParse(t.GetString(), out var seen))
                _lastSeenAt = seen;
            if (doc.RootElement.TryGetProperty("installationId", out var i))
                _installationId = i.GetString();
            if (doc.RootElement.TryGetProperty("extensionOrigin", out var o))
                _extensionOrigin = o.GetString();
        }
        catch { /* empty */ }
    }

    private void Save_NoLock()
    {
        File.WriteAllText(_storePath, JsonSerializer.Serialize(new
        {
            lastSeenAt = _lastSeenAt,
            installationId = _installationId,
            extensionOrigin = _extensionOrigin
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
}

/// <summary>Persists Copilot chat sessions started via the bridge (for resume / per-chat settings).</summary>
public sealed class ChatSessionStore
{
    private readonly object _gate = new();
    private readonly string _storePath;
    private readonly List<ChatSessionRecord> _sessions = new();

    public ChatSessionStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _storePath = Path.Combine(dataDirectory, "chat-sessions.json");
        Load();
    }

    public IReadOnlyList<ChatSessionRecord> List(int take = 50)
    {
        lock (_gate)
            return _sessions
                .Where(IsValidRecord)
                .OrderByDescending(s => s.LastActiveAt)
                .Take(take)
                .Select(Clone)
                .ToList();
    }

    public ChatSessionRecord? Get(string chatId)
    {
        lock (_gate)
        {
            var s = _sessions.FirstOrDefault(x => x.ChatId == chatId);
            return s is null ? null : Clone(s);
        }
    }

    public ChatSessionRecord Upsert(ChatSessionRecord incoming)
    {
        if (string.IsNullOrWhiteSpace(incoming.ChatId))
            throw new ArgumentException("chatId is required.", nameof(incoming));

        lock (_gate)
        {
            incoming = NormalizeRecord(incoming);

            // Real Copilot id with a deep link → fold any provisional bridge-* for this project.
            if (IsRealCopilotChatId(incoming.ChatId) &&
                !string.IsNullOrWhiteSpace(incoming.CopilotUrl) &&
                HasConversationDeepLink(incoming.CopilotUrl))
            {
                AbsorbProvisionals_NoLock(incoming);
            }

            var existing = _sessions.FirstOrDefault(x => x.ChatId == incoming.ChatId);
            if (existing is null)
            {
                incoming.CreatedAt = incoming.CreatedAt == default ? DateTimeOffset.UtcNow : incoming.CreatedAt;
                incoming.LastActiveAt = DateTimeOffset.UtcNow;
                if (string.IsNullOrWhiteSpace(incoming.Mode)) incoming.Mode = "assisted";
                _sessions.Add(incoming);
                Save_NoLock();
                return Clone(incoming);
            }

            if (!string.IsNullOrWhiteSpace(incoming.Title)) existing.Title = incoming.Title;
            if (!string.IsNullOrWhiteSpace(incoming.ProjectAlias)) existing.ProjectAlias = incoming.ProjectAlias;
            if (!string.IsNullOrWhiteSpace(incoming.Mode)) existing.Mode = incoming.Mode;
            if (!string.IsNullOrWhiteSpace(incoming.CopilotUrl)) existing.CopilotUrl = incoming.CopilotUrl;
            if (incoming.RootAliases is { Count: > 0 }) existing.RootAliases = incoming.RootAliases.ToList();
            existing.LastActiveAt = DateTimeOffset.UtcNow;
            Save_NoLock();
            return Clone(existing);
        }
    }

    public bool Remove(string chatId)
    {
        lock (_gate)
        {
            var n = _sessions.RemoveAll(s => s.ChatId == chatId);
            if (n > 0) Save_NoLock();
            return n > 0;
        }
    }

    /// <summary>When Copilot assigns a real conversation id, remount the stored session under it.</summary>
    public ChatSessionRecord? RemapChatId(string fromChatId, string toChatId)
    {
        if (string.IsNullOrWhiteSpace(fromChatId) || string.IsNullOrWhiteSpace(toChatId)) return null;
        if (string.Equals(fromChatId, toChatId, StringComparison.Ordinal)) return Get(toChatId);
        lock (_gate)
        {
            var existing = _sessions.FirstOrDefault(x => x.ChatId == fromChatId);
            if (existing is null) return null;
            var clash = _sessions.FirstOrDefault(x => x.ChatId == toChatId);
            var deepLink = $"https://m365.cloud.microsoft/chat/conversation/{Uri.EscapeDataString(toChatId)}";
            if (clash is not null)
            {
                // Keep the destination; merge useful fields then drop the old id.
                if (string.IsNullOrWhiteSpace(clash.Title) || LooksLikeBootstrapTitle(clash.Title))
                    clash.Title = string.IsNullOrWhiteSpace(existing.Title) ? clash.Title : existing.Title;
                if (string.IsNullOrWhiteSpace(clash.ProjectAlias)) clash.ProjectAlias = existing.ProjectAlias;
                if (string.IsNullOrWhiteSpace(clash.Mode)) clash.Mode = existing.Mode;
                clash.CopilotUrl = deepLink;
                if (clash.RootAliases is null || clash.RootAliases.Count == 0)
                    clash.RootAliases = existing.RootAliases?.ToList() ?? new List<string>();
                clash.LastActiveAt = DateTimeOffset.UtcNow;
                _sessions.RemoveAll(s => s.ChatId == fromChatId);
                AbsorbProvisionals_NoLock(clash);
                Save_NoLock();
                return Clone(clash);
            }

            existing.ChatId = toChatId;
            existing.LastActiveAt = DateTimeOffset.UtcNow;
            existing.CopilotUrl = deepLink;
            AbsorbProvisionals_NoLock(existing);
            Save_NoLock();
            return Clone(existing);
        }
    }

    /// <summary>Drop provisional bridge-* rows for the same project once a real chat link exists.</summary>
    private void AbsorbProvisionals_NoLock(ChatSessionRecord real)
    {
        if (!IsRealCopilotChatId(real.ChatId)) return;
        var alias = real.ProjectAlias?.Trim() ?? "";
        var doomed = _sessions
            .Where(s =>
                !string.Equals(s.ChatId, real.ChatId, StringComparison.Ordinal) &&
                s.ChatId.StartsWith("bridge-", StringComparison.OrdinalIgnoreCase) &&
                (alias.Length == 0 ||
                 string.Equals(s.ProjectAlias, alias, StringComparison.OrdinalIgnoreCase) ||
                 (s.RootAliases?.Any(a => string.Equals(a, alias, StringComparison.OrdinalIgnoreCase)) ?? false)))
            .ToList();
        foreach (var p in doomed)
        {
            if ((string.IsNullOrWhiteSpace(real.Title) || LooksLikeBootstrapTitle(real.Title)) &&
                !string.IsNullOrWhiteSpace(p.Title) && !LooksLikeBootstrapTitle(p.Title))
            {
                real.Title = p.Title;
            }
            if (string.IsNullOrWhiteSpace(real.ProjectAlias)) real.ProjectAlias = p.ProjectAlias;
            if (string.IsNullOrWhiteSpace(real.Mode)) real.Mode = p.Mode;
            if (real.RootAliases is null || real.RootAliases.Count == 0)
                real.RootAliases = p.RootAliases?.ToList() ?? new List<string>();
            _sessions.Remove(p);
        }
    }

    private static bool IsRealCopilotChatId(string chatId) =>
        !string.IsNullOrWhiteSpace(chatId) &&
        !chatId.StartsWith("bridge-", StringComparison.OrdinalIgnoreCase) &&
        chatId.Length >= 8 &&
        chatId is not ("conversation" or "chat" or "new" or "home" or "thread");

    private static bool LooksLikeBootstrapTitle(string? title) =>
        !string.IsNullOrWhiteSpace(title) &&
        (title.StartsWith("##", StringComparison.Ordinal) ||
         title.Contains("Local Context Bridge", StringComparison.OrdinalIgnoreCase) &&
         title.Contains("Read-only", StringComparison.OrdinalIgnoreCase));

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            var list = JsonSerializer.Deserialize<List<ChatSessionRecord>>(File.ReadAllText(_storePath), opts);
            if (list is null) return;
            // Drop corrupt rows (e.g. camelCase file loaded by an older case-sensitive deserializer).
            var valid = list.Where(IsValidRecord).Select(NormalizeRecord).ToList();
            _sessions.AddRange(valid);
            if (valid.Count != list.Count)
                Save_NoLock();
        }
        catch { /* empty */ }
    }

    private static bool IsValidRecord(ChatSessionRecord s)
    {
        var id = s.ChatId?.Trim() ?? "";
        if (id.Length < 8) return false;
        if (id is "conversation" or "chat" or "new" or "home" or "thread") return false;
        return true;
    }

    private static ChatSessionRecord NormalizeRecord(ChatSessionRecord s)
    {
        if (s.CreatedAt == default) s.CreatedAt = DateTimeOffset.UtcNow;
        if (s.LastActiveAt == default) s.LastActiveAt = s.CreatedAt;
        if (string.IsNullOrWhiteSpace(s.Mode)) s.Mode = "assisted";
        s.RootAliases ??= new List<string>();
        // Drop bogus deep links like conversationId=conversation
        if (!string.IsNullOrWhiteSpace(s.CopilotUrl) &&
            (s.CopilotUrl.Contains("conversationId=conversation", StringComparison.OrdinalIgnoreCase) ||
             s.CopilotUrl.Contains("threadId=conversation", StringComparison.OrdinalIgnoreCase) ||
             s.CopilotUrl.Equals("https://m365.cloud.microsoft/chat", StringComparison.OrdinalIgnoreCase) ||
             s.CopilotUrl.Equals("https://m365.cloud.microsoft/chat/", StringComparison.OrdinalIgnoreCase)))
        {
            s.CopilotUrl = null;
        }
        return s;
    }

    /// <summary>Deep link only when we captured a real Copilot conversation URL.</summary>
    public static string? ResolveOpenUrl(ChatSessionRecord s)
    {
        if (string.IsNullOrWhiteSpace(s.CopilotUrl)) return null;
        if (!HasConversationDeepLink(s.CopilotUrl)) return null;
        if (s.CopilotUrl.Contains("conversationId=conversation", StringComparison.OrdinalIgnoreCase))
            return null;
        if (s.CopilotUrl.Contains("/chat/conversation/conversation", StringComparison.OrdinalIgnoreCase))
            return null;
        return s.CopilotUrl;
    }

    private static bool HasConversationDeepLink(string url) =>
        url.Contains("conversationId=", StringComparison.OrdinalIgnoreCase) ||
        url.Contains("threadId=", StringComparison.OrdinalIgnoreCase) ||
        url.Contains("/chat/conversation/", StringComparison.OrdinalIgnoreCase);

    private void Save_NoLock()
    {
        var opts = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };
        File.WriteAllText(_storePath, JsonSerializer.Serialize(_sessions, opts));
    }

    private static ChatSessionRecord Clone(ChatSessionRecord s) => new()
    {
        ChatId = s.ChatId,
        Title = s.Title,
        ProjectAlias = s.ProjectAlias,
        Mode = s.Mode,
        CopilotUrl = s.CopilotUrl,
        RootAliases = s.RootAliases?.ToList() ?? new List<string>(),
        CreatedAt = s.CreatedAt,
        LastActiveAt = s.LastActiveAt
    };
}

public sealed class ChatSessionRecord
{
    public string ChatId { get; set; } = "";
    public string Title { get; set; } = "";
    public string ProjectAlias { get; set; } = "";
    public string Mode { get; set; } = "assisted";
    public string? CopilotUrl { get; set; }
    public List<string> RootAliases { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastActiveAt { get; set; }
}

/// <summary>UI theme preference for /setup and /app.</summary>
public sealed class UiPreferenceStore
{
    private readonly object _gate = new();
    private readonly string _storePath;
    private string _theme = "system"; // system | light | dark

    public UiPreferenceStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _storePath = Path.Combine(dataDirectory, "ui-preferences.json");
        Load();
    }

    public string Theme
    {
        get { lock (_gate) return _theme; }
    }

    public void SetTheme(string theme)
    {
        var t = theme.Trim().ToLowerInvariant();
        if (t is not ("system" or "light" or "dark")) t = "system";
        lock (_gate)
        {
            _theme = t;
            File.WriteAllText(_storePath, JsonSerializer.Serialize(new { theme = _theme }, new JsonSerializerOptions { WriteIndented = true }));
        }
    }

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(_storePath));
            if (doc.RootElement.TryGetProperty("theme", out var th))
            {
                var t = th.GetString()?.ToLowerInvariant();
                if (t is "system" or "light" or "dark") _theme = t;
            }
        }
        catch { /* empty */ }
    }
}

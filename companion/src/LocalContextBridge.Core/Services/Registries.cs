using System.Text.Json;
using LocalContextBridge.Core.Models;

namespace LocalContextBridge.Core.Services;

public sealed class ApprovedRootRegistry
{
    private readonly object _gate = new();
    private readonly string _storePath;
    private readonly List<ApprovedRoot> _roots = new();

    public ApprovedRootRegistry(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _storePath = Path.Combine(dataDirectory, "approved-roots.json");
        Load();
    }

    public IReadOnlyList<ApprovedRoot> GetAll()
    {
        lock (_gate) return _roots.Select(Clone).ToList();
    }

    public ApprovedRoot? GetByAlias(string alias)
    {
        lock (_gate)
            return _roots.FirstOrDefault(r => r.Alias.Equals(alias, StringComparison.OrdinalIgnoreCase)) is { } r
                ? Clone(r) : null;
    }

    public ApprovedRoot? GetPrimary()
    {
        lock (_gate)
            return _roots.FirstOrDefault(r => r.IsPrimary) is { } r ? Clone(r) : _roots.FirstOrDefault() is { } f ? Clone(f) : null;
    }

    public ApprovedRoot Upsert(string absolutePath, string alias, bool primary, AccessPolicy policy = AccessPolicy.AskPerSession, PersistenceKind persistence = PersistenceKind.Permanent)
    {
        var full = Path.GetFullPath(absolutePath);
        if (!Directory.Exists(full))
            throw new InvalidOperationException("Directory does not exist.");

        lock (_gate)
        {
            var existing = _roots.FirstOrDefault(r =>
                r.AbsolutePath.Equals(full, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal)
                || r.Alias.Equals(alias, StringComparison.OrdinalIgnoreCase));

            if (existing is null)
            {
                existing = new ApprovedRoot
                {
                    Id = Guid.NewGuid().ToString("N"),
                    Alias = alias,
                    AbsolutePath = full,
                    IsPrimary = primary,
                    AccessPolicy = policy,
                    Persistence = persistence
                };
                _roots.Add(existing);
            }
            else
            {
                existing.Alias = alias;
                existing.AbsolutePath = full;
                existing.AccessPolicy = policy;
                existing.Persistence = persistence;
                if (primary) existing.IsPrimary = true;
            }

            if (primary)
            {
                foreach (var r in _roots)
                    r.IsPrimary = ReferenceEquals(r, existing) || r.Id == existing.Id;
            }

            Save_NoLock();
            return Clone(existing);
        }
    }

    public bool Remove(string id)
    {
        lock (_gate)
        {
            var n = _roots.RemoveAll(r => r.Id == id);
            if (n > 0) Save_NoLock();
            return n > 0;
        }
    }

    public void ClearSessionOnly()
    {
        lock (_gate)
        {
            _roots.RemoveAll(r => r.Persistence == PersistenceKind.SessionOnly);
            Save_NoLock();
        }
    }

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            var json = File.ReadAllText(_storePath);
            var list = JsonSerializer.Deserialize<List<ApprovedRoot>>(json) ?? new();
            lock (_gate)
            {
                _roots.Clear();
                _roots.AddRange(list.Where(r => r.Persistence == PersistenceKind.Permanent));
            }
        }
        catch
        {
            // fail closed to empty registry
        }
    }

    private void Save_NoLock()
    {
        var permanent = _roots.Where(r => r.Persistence == PersistenceKind.Permanent).ToList();
        var json = JsonSerializer.Serialize(permanent, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_storePath, json);
    }

    private static ApprovedRoot Clone(ApprovedRoot r) => new()
    {
        Id = r.Id,
        Alias = r.Alias,
        AbsolutePath = r.AbsolutePath,
        IsPrimary = r.IsPrimary,
        ReadOnly = r.ReadOnly,
        AccessPolicy = r.AccessPolicy,
        Persistence = r.Persistence
    };
}

public sealed class PairingService
{
    private readonly object _gate = new();
    private readonly string _storePath;
    private readonly List<PairingRequestState> _pending = new();
    private readonly List<PairedClient> _clients = new();

    public PairingService(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _storePath = Path.Combine(dataDirectory, "pairing.json");
        Load();
    }

    public PairingRequestState Request(string installationId, string extensionOrigin)
    {
        if (string.IsNullOrWhiteSpace(installationId) || string.IsNullOrWhiteSpace(extensionOrigin))
            throw new ArgumentException("installationId and extensionOrigin are required.");

        var state = new PairingRequestState
        {
            Id = Guid.NewGuid().ToString("N"),
            InstallationId = installationId,
            ExtensionOrigin = extensionOrigin.TrimEnd('/'),
            OneTimeCode = CreateCode(),
            CreatedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5)
        };
        lock (_gate)
        {
            _pending.RemoveAll(p => p.ExpiresAt < DateTimeOffset.UtcNow || p.Redeemed);
            _pending.Add(state);
            Save_NoLock();
        }
        return state;
    }

    public PairingRequestState? GetStatus(string id)
    {
        lock (_gate)
        {
            var p = _pending.FirstOrDefault(x => x.Id == id);
            if (p is null) return null;
            return new PairingRequestState
            {
                Id = p.Id,
                InstallationId = p.InstallationId,
                ExtensionOrigin = p.ExtensionOrigin,
                OneTimeCode = p.Approved ? "" : p.OneTimeCode, // still show code until approved for local UI; API status hides token
                CreatedAt = p.CreatedAt,
                ExpiresAt = p.ExpiresAt,
                Approved = p.Approved,
                Redeemed = p.Redeemed
            };
        }
    }

    public IReadOnlyList<PairingRequestState> ListPending()
    {
        lock (_gate)
            return _pending.Where(p => !p.Redeemed && p.ExpiresAt > DateTimeOffset.UtcNow)
                .Select(p => new PairingRequestState
                {
                    Id = p.Id,
                    InstallationId = p.InstallationId,
                    ExtensionOrigin = p.ExtensionOrigin,
                    OneTimeCode = p.OneTimeCode,
                    CreatedAt = p.CreatedAt,
                    ExpiresAt = p.ExpiresAt,
                    Approved = p.Approved,
                    Redeemed = p.Redeemed
                }).ToList();
    }

    public bool Approve(string id)
    {
        lock (_gate)
        {
            var p = _pending.FirstOrDefault(x => x.Id == id);
            if (p is null || p.ExpiresAt < DateTimeOffset.UtcNow || p.Redeemed) return false;
            p.Approved = true;
            Save_NoLock();
            return true;
        }
    }

    public string? Redeem(string id, string installationId, string extensionOrigin)
    {
        lock (_gate)
        {
            var p = _pending.FirstOrDefault(x => x.Id == id);
            if (p is null || !p.Approved || p.Redeemed || p.ExpiresAt < DateTimeOffset.UtcNow)
                return null;
            if (!p.InstallationId.Equals(installationId, StringComparison.Ordinal) ||
                !p.ExtensionOrigin.Equals(extensionOrigin.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
                return null;

            var token = CreateToken();
            var hash = HashToken(token);
            p.Redeemed = true;
            p.TokenHash = hash;
            _clients.RemoveAll(c => c.InstallationId == installationId && c.ExtensionOrigin == p.ExtensionOrigin);
            _clients.Add(new PairedClient
            {
                InstallationId = installationId,
                ExtensionOrigin = p.ExtensionOrigin,
                TokenHash = hash,
                PairedAt = DateTimeOffset.UtcNow
            });
            Save_NoLock();
            return token; // returned once
        }
    }

    /// <summary>
    /// Loopback one-click pair: issue a token immediately for the extension on this machine
    /// (no OTP). Used after an explicit user Start click.
    /// </summary>
    public string AutoPair(string installationId, string extensionOrigin)
    {
        if (string.IsNullOrWhiteSpace(installationId) || string.IsNullOrWhiteSpace(extensionOrigin))
            throw new ArgumentException("installationId and extensionOrigin are required.");

        var origin = extensionOrigin.TrimEnd('/');
        lock (_gate)
        {
            // Re-issue: revoke prior clients for this installation+origin.
            _clients.RemoveAll(c =>
                c.InstallationId == installationId &&
                c.ExtensionOrigin.Equals(origin, StringComparison.OrdinalIgnoreCase));
            var token = CreateToken();
            _clients.Add(new PairedClient
            {
                InstallationId = installationId,
                ExtensionOrigin = origin,
                TokenHash = HashToken(token),
                PairedAt = DateTimeOffset.UtcNow
            });
            Save_NoLock();
            return token;
        }
    }

    public bool ValidateToken(string token, string? origin)
    {
        if (string.IsNullOrEmpty(token)) return false;
        var hash = HashToken(token);
        lock (_gate)
        {
            var client = _clients.FirstOrDefault(c => c.TokenHash == hash && !c.Revoked);
            if (client is null) return false;
            if (!string.IsNullOrEmpty(origin))
            {
                var o = origin.TrimEnd('/');
                if (!client.ExtensionOrigin.Equals(o, StringComparison.OrdinalIgnoreCase) &&
                    !o.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase) &&
                    !o.Equals("http://127.0.0.1:32178", StringComparison.OrdinalIgnoreCase))
                {
                    // Allow chrome-extension origins that match paired extension origin
                    if (!client.ExtensionOrigin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase) ||
                        !o.Equals(client.ExtensionOrigin, StringComparison.OrdinalIgnoreCase))
                    {
                        // Still allow exact match only
                        if (!client.ExtensionOrigin.Equals(o, StringComparison.OrdinalIgnoreCase))
                            return false;
                    }
                }
            }
            return true;
        }
    }

    public bool IsPaired()
    {
        lock (_gate) return _clients.Any(c => !c.Revoked);
    }

    public void RevokeAll()
    {
        lock (_gate)
        {
            foreach (var c in _clients) c.Revoked = true;
            _pending.Clear();
            Save_NoLock();
        }
    }

    public static string HashToken(string token)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string CreateToken()
    {
        var bytes = new byte[32];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes);
    }

    private static string CreateCode()
    {
        var bytes = new byte[4];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(_storePath));
            if (doc.RootElement.TryGetProperty("clients", out var clients))
            {
                foreach (var c in clients.EnumerateArray())
                {
                    _clients.Add(new PairedClient
                    {
                        InstallationId = c.GetProperty("InstallationId").GetString()!,
                        ExtensionOrigin = c.GetProperty("ExtensionOrigin").GetString()!,
                        TokenHash = c.GetProperty("TokenHash").GetString()!,
                        PairedAt = c.GetProperty("PairedAt").GetDateTimeOffset(),
                        Revoked = c.TryGetProperty("Revoked", out var r) && r.GetBoolean()
                    });
                }
            }
        }
        catch { /* empty */ }
    }

    private void Save_NoLock()
    {
        var payload = new
        {
            clients = _clients.Where(c => !c.Revoked).ToList()
        };
        File.WriteAllText(_storePath, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }));
    }
}

/// <summary>User preferences shared by the desktop app and Chrome extension (e.g. default session mode).</summary>
public sealed class PreferenceStore
{
    private readonly object _gate = new();
    private readonly string _storePath;
    private string _defaultMode = "assisted";

    public PreferenceStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _storePath = Path.Combine(dataDirectory, "preferences.json");
        Load();
    }

    public string DefaultMode
    {
        get { lock (_gate) return _defaultMode; }
    }

    public void SetDefaultMode(string mode)
    {
        var normalized = NormalizeMode(mode);
        lock (_gate)
        {
            _defaultMode = normalized;
            Save_NoLock();
        }
    }

    public object Snapshot()
    {
        lock (_gate) return new { defaultMode = _defaultMode };
    }

    private static string NormalizeMode(string mode)
    {
        return mode.Trim().ToLowerInvariant() switch
        {
            "manual" => "manual",
            "automatic" => "automatic",
            _ => "assisted"
        };
    }

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(_storePath));
            if (doc.RootElement.TryGetProperty("defaultMode", out var m))
                _defaultMode = NormalizeMode(m.GetString() ?? "assisted");
        }
        catch { /* empty */ }
    }

    private void Save_NoLock()
    {
        File.WriteAllText(_storePath, JsonSerializer.Serialize(new { defaultMode = _defaultMode }, new JsonSerializerOptions { WriteIndented = true }));
    }
}

/// <summary>One-shot pending session start requested by the desktop app.</summary>
public sealed class PendingStartStore
{
    private readonly object _gate = new();
    private readonly string _storePath;
    private PendingStart? _pending;

    public PendingStartStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _storePath = Path.Combine(dataDirectory, "pending-start.json");
        Load();
    }

    public void Set(
        string? mode,
        string? rootAlias,
        string? initialTask = null,
        bool explore = true,
        string? sessionId = null,
        string? title = null)
    {
        lock (_gate)
        {
            _pending = new PendingStart
            {
                Mode = string.IsNullOrWhiteSpace(mode) ? null : mode.Trim().ToLowerInvariant(),
                RootAlias = string.IsNullOrWhiteSpace(rootAlias) ? null : rootAlias.Trim(),
                InitialTask = string.IsNullOrWhiteSpace(initialTask) ? null : initialTask.Trim(),
                Explore = explore,
                SessionId = string.IsNullOrWhiteSpace(sessionId) ? null : sessionId.Trim(),
                Title = string.IsNullOrWhiteSpace(title) ? null : title.Trim(),
                CreatedAt = DateTimeOffset.UtcNow,
                ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5)
            };
            Save_NoLock();
        }
    }

    /// <summary>Returns and clears a non-expired pending start, or null.</summary>
    public PendingStart? Consume()
    {
        lock (_gate)
        {
            var p = _pending;
            _pending = null;
            Save_NoLock();
            if (p is null) return null;
            if (p.ExpiresAt < DateTimeOffset.UtcNow) return null;
            return p;
        }
    }

    public PendingStart? Peek()
    {
        lock (_gate)
        {
            if (_pending is null) return null;
            if (_pending.ExpiresAt < DateTimeOffset.UtcNow)
            {
                _pending = null;
                Save_NoLock();
                return null;
            }
            return _pending;
        }
    }

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            _pending = JsonSerializer.Deserialize<PendingStart>(File.ReadAllText(_storePath));
        }
        catch { _pending = null; }
    }

    private void Save_NoLock()
    {
        if (_pending is null)
        {
            if (File.Exists(_storePath)) File.Delete(_storePath);
            return;
        }
        File.WriteAllText(_storePath, JsonSerializer.Serialize(_pending, new JsonSerializerOptions { WriteIndented = true }));
    }
}

public sealed class PendingStart
{
    public string? Mode { get; set; }
    public string? RootAlias { get; set; }
    public string? InitialTask { get; set; }
    public bool Explore { get; set; } = true;
    /// <summary>Provisional chat/session id recorded in ChatSessionStore before Copilot assigns a real id.</summary>
    public string? SessionId { get; set; }
    public string? Title { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class AuditLogService
{
    private readonly object _gate = new();
    private readonly string _storePath;
    private readonly List<AuditEntry> _entries = new();
    private const int MaxEntries = 500;

    public AuditLogService(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _storePath = Path.Combine(dataDirectory, "audit.json");
        Load();
    }

    public void Add(string category, string message, bool success, string? correlationId = null, string? tool = null, string? rootAlias = null)
    {
        // Never log tokens or full source
        message = Truncate(message, 500);
        var entry = new AuditEntry
        {
            Id = Guid.NewGuid().ToString("N"),
            Timestamp = DateTimeOffset.UtcNow,
            Category = category,
            Message = message,
            CorrelationId = correlationId,
            Tool = tool,
            RootAlias = rootAlias,
            Success = success
        };
        lock (_gate)
        {
            _entries.Add(entry);
            while (_entries.Count > MaxEntries) _entries.RemoveAt(0);
            Save_NoLock();
        }
    }

    public IReadOnlyList<AuditEntry> List(int take = 100)
    {
        lock (_gate) return _entries.AsEnumerable().Reverse().Take(take).ToList();
    }

    public void Clear()
    {
        lock (_gate)
        {
            _entries.Clear();
            Save_NoLock();
        }
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            var list = JsonSerializer.Deserialize<List<AuditEntry>>(File.ReadAllText(_storePath));
            if (list is not null) _entries.AddRange(list);
        }
        catch { }
    }

    private void Save_NoLock()
    {
        File.WriteAllText(_storePath, JsonSerializer.Serialize(_entries, new JsonSerializerOptions { WriteIndented = true }));
    }
}

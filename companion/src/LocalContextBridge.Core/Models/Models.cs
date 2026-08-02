namespace LocalContextBridge.Core.Models;

public enum AccessPolicy
{
    Automatic,
    AskPerSession,
    AskEveryOperation,
    Denied
}

public enum PersistenceKind
{
    Permanent,
    SessionOnly
}

public sealed class BridgeLimits
{
    public int MaxIterations { get; init; } = 0;
    public int MaxSessionMinutes { get; init; } = 0;
    public int MaxRequestBytes { get; init; } = 32 * 1024;
    public int MaxResultBytes { get; init; } = 128 * 1024;
    public int MaxReadLines { get; init; } = 300;
    public int MaxTextFileBytes { get; init; } = 2 * 1024 * 1024;
    public int MaxSearchFiles { get; init; } = 5000;
    public int MaxSearchResults { get; init; } = 100;
    public int MaxConcurrentRequests { get; init; } = 1;
    public int ToolTimeoutSeconds { get; init; } = 60;
    public int MinCallIntervalMs { get; init; } = 500;
    public int TimestampSkewSeconds { get; init; } = 60;
}

public sealed class ApprovedRoot
{
    public required string Id { get; init; }
    public required string Alias { get; set; }
    public required string AbsolutePath { get; set; }
    public bool IsPrimary { get; set; }
    public bool ReadOnly { get; init; } = true;
    public AccessPolicy AccessPolicy { get; set; } = AccessPolicy.AskPerSession;
    public PersistenceKind Persistence { get; set; } = PersistenceKind.Permanent;
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// The only shape of an approved root ever exposed to the extension / tool results.
/// The absolute filesystem path is never included.
/// </summary>
public sealed record ApprovedRootPublicView(
    string Alias,
    bool IsPrimary,
    AccessPolicy AccessPolicy,
    PersistenceKind Persistence);

public sealed class LocalToolRequest
{
    public string ProtocolVersion { get; set; } = "1.0";
    public string Type { get; set; } = "LOCAL_TOOL_REQUEST";
    public required string Id { get; set; }
    public required string Tool { get; set; }
    public Dictionary<string, object?> Arguments { get; set; } = new();
}

public sealed class LocalToolResult
{
    public string ProtocolVersion { get; set; } = "1.0";
    public string Type { get; set; } = "LOCAL_TOOL_RESULT";
    public required string RequestId { get; set; }
    public bool Success { get; set; }
    public required string Tool { get; set; }
    public long DurationMs { get; set; }
    public bool Truncated { get; set; }
    public object? Data { get; set; }
    public List<string> Warnings { get; set; } = new();
    public ToolError? Error { get; set; }
}

public sealed class ToolError
{
    public required string Code { get; set; }
    public required string Message { get; set; }
    public string? CorrelationId { get; set; }
}

public sealed class PairingRequestState
{
    public required string Id { get; init; }
    public required string InstallationId { get; init; }
    public required string ExtensionOrigin { get; init; }
    public required string OneTimeCode { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset ExpiresAt { get; init; }
    public bool Approved { get; set; }
    public bool Redeemed { get; set; }
    public string? TokenHash { get; set; }
}

public sealed class PairedClient
{
    public required string InstallationId { get; init; }
    public required string ExtensionOrigin { get; init; }
    public required string TokenHash { get; init; }
    public DateTimeOffset PairedAt { get; init; }
    public bool Revoked { get; set; }
}

public sealed class AuditEntry
{
    public required string Id { get; init; }
    public DateTimeOffset Timestamp { get; init; }
    public required string Category { get; init; }
    public required string Message { get; init; }
    public string? CorrelationId { get; init; }
    public string? Tool { get; init; }
    public string? RootAlias { get; init; }
    public bool Success { get; init; }
}

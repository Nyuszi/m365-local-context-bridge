using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace LocalContextBridge.Core.Security;

public sealed class SecretRedactionService
{
    private static readonly (Regex Pattern, string Replacement)[] Patterns =
    [
        (new Regex(@"(?i)(api[_-]?key|secret|token|password|pwd)\s*[=:]\s*['\""]?([^\s'\""]+)['\""]?", RegexOptions.Compiled),
            "$1=***REDACTED***"),
        (new Regex(@"(?i)(Bearer\s+)[A-Za-z0-9\-._~+/]+=*", RegexOptions.Compiled), "$1***REDACTED***"),
        (new Regex(@"(?i)(AccountKey=)[^;]+", RegexOptions.Compiled), "$1***REDACTED***"),
        (new Regex(@"(?i)(SharedAccessSignature=)[^;\s]+", RegexOptions.Compiled), "$1***REDACTED***"),
        (new Regex(@"-----BEGIN ([A-Z ]*PRIVATE KEY|RSA PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END \1-----",
            RegexOptions.Compiled), "***REDACTED PRIVATE KEY***"),
        (new Regex(@"(?i)(mongodb(\+srv)?:\/\/)([^:\s]+):([^@\s]+)@", RegexOptions.Compiled), "$1***:***@"),
        (new Regex(@"(?i)(postgres(ql)?|mysql|redis):\/\/([^:\s]+):([^@\s]+)@", RegexOptions.Compiled), "$1://***:***@"),
    ];

    public string Redact(string content)
    {
        if (string.IsNullOrEmpty(content)) return content;
        var result = content;
        foreach (var (pattern, replacement) in Patterns)
            result = pattern.Replace(result, replacement);
        return result;
    }
}

public sealed class BinaryDetectionService
{
    public bool IsBinary(Stream stream, int sampleSize = 8192)
    {
        var buffer = new byte[sampleSize];
        var read = stream.Read(buffer, 0, buffer.Length);
        if (read == 0) return false;
        for (var i = 0; i < read; i++)
        {
            if (buffer[i] == 0) return true;
        }
        // High ratio of non-text control chars
        var weird = 0;
        for (var i = 0; i < read; i++)
        {
            var b = buffer[i];
            if (b < 7 || (b > 13 && b < 32 && b != 27)) weird++;
        }
        return weird > read * 0.30;
    }

    public bool IsBinaryFile(string path)
    {
        using var fs = File.OpenRead(path);
        return IsBinary(fs);
    }

    public async Task<bool> IsBinaryFileAsync(string path, CancellationToken cancellationToken = default)
    {
        await using var fs = File.OpenRead(path);
        var buffer = new byte[8192];
        var read = await fs.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
        return IsBinary(new MemoryStream(buffer, 0, read));
    }
}

public sealed class OutputTruncationService
{
    public (string Text, bool Truncated) TruncateString(string text, int maxBytes)
    {
        var bytes = Encoding.UTF8.GetByteCount(text);
        if (bytes <= maxBytes) return (text, false);
        var chars = Encoding.UTF8.GetString(Encoding.UTF8.GetBytes(text), 0, Math.Min(bytes, maxBytes));
        // Ensure valid string boundary
        while (Encoding.UTF8.GetByteCount(chars) > maxBytes && chars.Length > 0)
            chars = chars[..^1];
        return (chars + "\n…[truncated]", true);
    }

    public (IReadOnlyList<string> Lines, bool Truncated) TruncateLines(IReadOnlyList<string> lines, int maxLines)
    {
        if (lines.Count <= maxLines) return (lines, false);
        return (lines.Take(maxLines).ToList(), true);
    }
}

public sealed class ReplayProtectionService
{
    private readonly object _gate = new();
    private readonly HashSet<string> _nonces = new(StringComparer.Ordinal);
    private readonly HashSet<string> _requestIds = new(StringComparer.Ordinal);
    private readonly HashSet<string> _payloadHashes = new(StringComparer.Ordinal);
    private readonly Queue<(string Key, DateTimeOffset Expiry)> _expiry = new();
    private readonly TimeSpan _ttl;

    public ReplayProtectionService(TimeSpan? ttl = null)
    {
        _ttl = ttl ?? TimeSpan.FromMinutes(10);
    }

    public bool TryAccept(string nonce, string requestId, string payloadHash, DateTimeOffset timestamp, int skewSeconds, out string error)
    {
        var now = DateTimeOffset.UtcNow;
        if (Math.Abs((now - timestamp).TotalSeconds) > skewSeconds)
        {
            error = "timestamp_out_of_range";
            return false;
        }

        lock (_gate)
        {
            Purge(now);
            if (!_nonces.Add(nonce))
            {
                error = "replay_nonce";
                return false;
            }
            if (!_requestIds.Add(requestId))
            {
                error = "duplicate_request_id";
                return false;
            }
            if (!_payloadHashes.Add(payloadHash))
            {
                error = "duplicate_payload";
                return false;
            }
            var exp = now.Add(_ttl);
            _expiry.Enqueue(("n:" + nonce, exp));
            _expiry.Enqueue(("r:" + requestId, exp));
            _expiry.Enqueue(("h:" + payloadHash, exp));
        }

        error = "";
        return true;
    }

    public static string Sha256Hex(string normalizedPayload)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedPayload));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private void Purge(DateTimeOffset now)
    {
        while (_expiry.Count > 0 && _expiry.Peek().Expiry <= now)
        {
            var (key, _) = _expiry.Dequeue();
            if (key.StartsWith("n:", StringComparison.Ordinal)) _nonces.Remove(key[2..]);
            else if (key.StartsWith("r:", StringComparison.Ordinal)) _requestIds.Remove(key[2..]);
            else if (key.StartsWith("h:", StringComparison.Ordinal)) _payloadHashes.Remove(key[2..]);
        }
    }
}

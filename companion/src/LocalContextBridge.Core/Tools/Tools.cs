using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LocalContextBridge.Core.Models;
using LocalContextBridge.Core.Security;
using LocalContextBridge.Core.Services;

namespace LocalContextBridge.Core.Tools;

public interface ITool
{
    string Name { get; }
    Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, ApprovedRoot root, CancellationToken ct);
}

public sealed class ToolRegistry
{
    private readonly Dictionary<string, ITool> _tools;
    private readonly ApprovedRootRegistry _roots;
    private readonly BridgeLimits _limits;
    private readonly SemaphoreSlim _concurrency;
    private DateTimeOffset _lastCall = DateTimeOffset.MinValue;
    private readonly object _rateGate = new();

    public ToolRegistry(IEnumerable<ITool> tools, ApprovedRootRegistry roots, BridgeLimits limits)
    {
        _tools = tools.ToDictionary(t => t.Name, StringComparer.Ordinal);
        _roots = roots;
        _limits = limits;
        _concurrency = new SemaphoreSlim(limits.MaxConcurrentRequests, limits.MaxConcurrentRequests);
    }

    public IReadOnlyCollection<string> Names => _tools.Keys;

    public async Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        if (!_tools.TryGetValue(request.Tool, out var tool))
        {
            return Fail(request, "unknown_tool", $"Unknown tool: {request.Tool}", sw.ElapsedMilliseconds);
        }

        var alias = GetString(request.Arguments, "rootAlias");
        var root = !string.IsNullOrEmpty(alias) ? _roots.GetByAlias(alias!) : _roots.GetPrimary();
        if (root is null)
            return Fail(request, "unknown_root", "Unknown or missing root alias.", sw.ElapsedMilliseconds);
        if (root.AccessPolicy == AccessPolicy.Denied)
            return Fail(request, "root_denied", "Root access is denied.", sw.ElapsedMilliseconds);

        lock (_rateGate)
        {
            var since = DateTimeOffset.UtcNow - _lastCall;
            if (since.TotalMilliseconds < _limits.MinCallIntervalMs)
            {
                return Fail(request, "rate_limited", "Minimum call interval not met.", sw.ElapsedMilliseconds);
            }
            _lastCall = DateTimeOffset.UtcNow;
        }

        if (!await _concurrency.WaitAsync(0, ct))
            return Fail(request, "busy", "Another tool request is in progress.", sw.ElapsedMilliseconds);

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(_limits.ToolTimeoutSeconds));
            var result = await tool.ExecuteAsync(request, root, timeout.Token);
            result.DurationMs = sw.ElapsedMilliseconds;
            return result;
        }
        catch (OperationCanceledException)
        {
            return Fail(request, "timeout", "Tool execution timed out.", sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            return Fail(request, "tool_error", "Tool failed: " + Sanitize(ex.Message), sw.ElapsedMilliseconds);
        }
        finally
        {
            _concurrency.Release();
        }
    }

    public static string? GetString(Dictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var v) || v is null) return null;
        if (v is JsonElement je)
        {
            return je.ValueKind == JsonValueKind.String ? je.GetString() : je.ToString();
        }
        return Convert.ToString(v);
    }

    public static int GetInt(Dictionary<string, object?> args, string key, int fallback)
    {
        if (!args.TryGetValue(key, out var v) || v is null) return fallback;
        if (v is JsonElement je)
        {
            if (je.ValueKind == JsonValueKind.Number && je.TryGetInt32(out var n)) return n;
            if (je.ValueKind == JsonValueKind.String && int.TryParse(je.GetString(), out var s)) return s;
            return fallback;
        }
        return int.TryParse(Convert.ToString(v), out var i) ? i : fallback;
    }

    private static LocalToolResult Fail(LocalToolRequest request, string code, string message, long ms) => new()
    {
        RequestId = request.Id,
        Success = false,
        Tool = request.Tool,
        DurationMs = ms,
        Truncated = false,
        Data = null,
        Warnings = new(),
        Error = new ToolError { Code = code, Message = message }
    };

    private static string Sanitize(string msg) =>
        msg.Length <= 200 ? msg : msg[..200];
}

public abstract class ToolBase : ITool
{
    public abstract string Name { get; }
    protected PathSecurityService Paths { get; }
    protected BridgeLimits Limits { get; }
    protected SecretRedactionService Redaction { get; }
    protected BinaryDetectionService Binary { get; }
    protected OutputTruncationService Truncation { get; }

    protected ToolBase(PathSecurityService paths, BridgeLimits limits, SecretRedactionService redaction, BinaryDetectionService binary, OutputTruncationService truncation)
    {
        Paths = paths;
        Limits = limits;
        Redaction = redaction;
        Binary = binary;
        Truncation = truncation;
    }

    public abstract Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, ApprovedRoot root, CancellationToken ct);

    protected LocalToolResult Ok(LocalToolRequest request, object data, bool truncated = false, List<string>? warnings = null) => new()
    {
        RequestId = request.Id,
        Success = true,
        Tool = Name,
        Truncated = truncated,
        Data = data,
        Warnings = warnings ?? new()
    };

    protected LocalToolResult Deny(LocalToolRequest request, PathSecurityResult r) => new()
    {
        RequestId = request.Id,
        Success = false,
        Tool = Name,
        Data = null,
        Error = new ToolError { Code = r.ErrorCode ?? "denied", Message = r.ErrorMessage ?? "Denied" }
    };
}

public sealed class ProjectInfoTool : ToolBase
{
    public ProjectInfoTool(PathSecurityService p, BridgeLimits l, SecretRedactionService r, BinaryDetectionService b, OutputTruncationService t) : base(p, l, r, b, t) { }
    public override string Name => "project_info";

    public override Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, ApprovedRoot root, CancellationToken ct)
    {
        var dir = new DirectoryInfo(root.AbsolutePath);
        return Task.FromResult(Ok(request, new
        {
            alias = root.Alias,
            readOnly = true,
            exists = dir.Exists,
            // never absolute path
            topLevelEntries = dir.Exists
                ? dir.GetFileSystemInfos().Take(50).Select(i => (object)new
                {
                    name = i.Name,
                    type = i is DirectoryInfo ? "directory" : "file"
                }).ToList()
                : new List<object>()
        }));
    }
}

public sealed class ListFilesTool : ToolBase
{
    public ListFilesTool(PathSecurityService p, BridgeLimits l, SecretRedactionService r, BinaryDetectionService b, OutputTruncationService t) : base(p, l, r, b, t) { }
    public override string Name => "list_files";

    public override Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, ApprovedRoot root, CancellationToken ct)
    {
        var rel = ToolRegistry.GetString(request.Arguments, "path") ?? ".";
        var resolved = Paths.ResolveWithinRoot(root.AbsolutePath, rel);
        if (!resolved.Allowed) return Task.FromResult(Deny(request, resolved));
        if (!Directory.Exists(resolved.FullPath))
            return Task.FromResult(Ok(request, new { path = resolved.RelativePath, entries = Array.Empty<object>() }, warnings: new List<string> { "not_a_directory" }));

        var entries = new List<object>();
        foreach (var info in new DirectoryInfo(resolved.FullPath!).EnumerateFileSystemInfos().Take(500))
        {
            if (info is DirectoryInfo && Paths.IsExcludedDirectoryName(info.Name)) continue;
            if (info is FileInfo && Paths.IsHardDeniedFile(info.Name)) continue;
            entries.Add(new
            {
                name = info.Name,
                path = string.IsNullOrEmpty(resolved.RelativePath) ? info.Name : $"{resolved.RelativePath}/{info.Name}",
                type = info is DirectoryInfo ? "directory" : "file"
            });
        }
        return Task.FromResult(Ok(request, new { path = resolved.RelativePath, entries }));
    }
}

public sealed class FindFilesTool : ToolBase
{
    public FindFilesTool(PathSecurityService p, BridgeLimits l, SecretRedactionService r, BinaryDetectionService b, OutputTruncationService t) : base(p, l, r, b, t) { }
    public override string Name => "find_files";

    public override Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, ApprovedRoot root, CancellationToken ct)
    {
        var pattern = ToolRegistry.GetString(request.Arguments, "pattern") ?? "*";
        var start = ToolRegistry.GetString(request.Arguments, "path") ?? ".";
        var resolved = Paths.ResolveWithinRoot(root.AbsolutePath, start);
        if (!resolved.Allowed) return Task.FromResult(Deny(request, resolved));

        var results = new List<string>();
        var truncated = false;
        var filesScanned = 0;
        foreach (var file in SafeEnumerateFiles(resolved.FullPath!))
        {
            ct.ThrowIfCancellationRequested();
            filesScanned++;
            if (filesScanned > Limits.MaxSearchFiles) { truncated = true; break; }
            var name = Path.GetFileName(file);
            if (Paths.IsHardDeniedFile(name)) continue;
            var relCheck = Paths.ResolveWithinRoot(root.AbsolutePath, Path.GetRelativePath(root.AbsolutePath, file));
            if (!relCheck.Allowed) continue;
            if (MatchesGlob(name, pattern) || MatchesGlob(relCheck.RelativePath!.Replace('\\', '/'), pattern))
            {
                results.Add(relCheck.RelativePath!.Replace('\\', '/'));
                if (results.Count >= Limits.MaxSearchResults) { truncated = true; break; }
            }
        }
        return Task.FromResult(Ok(request, new { pattern, files = results }, truncated));
    }

    private IEnumerable<string> SafeEnumerateFiles(string start)
    {
        var stack = new Stack<string>();
        stack.Push(start);
        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            IEnumerable<string> subdirs = Array.Empty<string>();
            try { subdirs = Directory.EnumerateDirectories(dir); } catch { continue; }
            foreach (var sd in subdirs)
            {
                var name = Path.GetFileName(sd);
                if (Paths.IsExcludedDirectoryName(name)) continue;
                var check = Paths.ResolveWithinRoot(Path.GetDirectoryName(start) is null ? start : start, // will revalidate against root in caller
                    sd);
                // Use path security relative to known root via full path boundary only
                if (!PathSecurityService.IsStrictlyWithinRoot(start.Contains(Path.DirectorySeparatorChar) ? Directory.GetParent(start)?.FullName ?? start : start, sd)
                    && !PathSecurityService.IsStrictlyWithinRoot(start, sd))
                {
                    // still push if under start
                }
                if (PathSecurityService.IsStrictlyWithinRoot(start, sd) || string.Equals(Path.GetFullPath(start), Path.GetFullPath(sd), StringComparison.Ordinal))
                    stack.Push(sd);
                else if (sd.StartsWith(Path.GetFullPath(start).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                    stack.Push(sd);
            }
            IEnumerable<string> files = Array.Empty<string>();
            try { files = Directory.EnumerateFiles(dir); } catch { }
            foreach (var f in files) yield return f;
        }
    }

    private static bool MatchesGlob(string input, string pattern)
    {
        var regex = "^" + Regex.Escape(pattern).Replace("\\*", ".*").Replace("\\?", ".") + "$";
        return Regex.IsMatch(input, regex, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }
}

public sealed class DirectorySummaryTool : ToolBase
{
    public DirectorySummaryTool(PathSecurityService p, BridgeLimits l, SecretRedactionService r, BinaryDetectionService b, OutputTruncationService t) : base(p, l, r, b, t) { }
    public override string Name => "directory_summary";

    public override Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, ApprovedRoot root, CancellationToken ct)
    {
        var rel = ToolRegistry.GetString(request.Arguments, "path") ?? ".";
        var depth = Math.Clamp(ToolRegistry.GetInt(request.Arguments, "depth", 2), 1, 4);
        var resolved = Paths.ResolveWithinRoot(root.AbsolutePath, rel);
        if (!resolved.Allowed) return Task.FromResult(Deny(request, resolved));
        if (!Directory.Exists(resolved.FullPath))
            return Task.FromResult(Ok(request, new { path = resolved.RelativePath, summary = Array.Empty<object>() }));

        var nodes = Summarize(resolved.FullPath!, resolved.RelativePath ?? "", depth, 0);
        return Task.FromResult(Ok(request, new { path = resolved.RelativePath, summary = nodes }));
    }

    private List<object> Summarize(string full, string rel, int maxDepth, int depth)
    {
        var list = new List<object>();
        if (depth >= maxDepth) return list;
        try
        {
            foreach (var info in new DirectoryInfo(full).EnumerateFileSystemInfos().Take(100))
            {
                if (info is DirectoryInfo di)
                {
                    if (Paths.IsExcludedDirectoryName(di.Name)) continue;
                    var childRel = string.IsNullOrEmpty(rel) ? di.Name : $"{rel}/{di.Name}";
                    list.Add(new
                    {
                        name = di.Name,
                        path = childRel,
                        type = "directory",
                        children = Summarize(di.FullName, childRel, maxDepth, depth + 1)
                    });
                }
                else
                {
                    if (Paths.IsHardDeniedFile(info.Name)) continue;
                    var childRel = string.IsNullOrEmpty(rel) ? info.Name : $"{rel}/{info.Name}";
                    list.Add(new { name = info.Name, path = childRel, type = "file" });
                }
            }
        }
        catch { }
        return list;
    }
}

public sealed class SearchTextTool : ToolBase
{
    public SearchTextTool(PathSecurityService p, BridgeLimits l, SecretRedactionService r, BinaryDetectionService b, OutputTruncationService t) : base(p, l, r, b, t) { }
    public override string Name => "search_text";

    public override Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, ApprovedRoot root, CancellationToken ct)
    {
        var query = ToolRegistry.GetString(request.Arguments, "query");
        if (string.IsNullOrEmpty(query) || query.Length > 500)
            return Task.FromResult(new LocalToolResult
            {
                RequestId = request.Id,
                Success = false,
                Tool = Name,
                Error = new ToolError { Code = "invalid_query", Message = "Query is required and must be <= 500 chars." }
            });

        var path = ToolRegistry.GetString(request.Arguments, "path") ?? ".";
        var filePattern = ToolRegistry.GetString(request.Arguments, "filePattern") ?? "*";
        var useRegex = string.Equals(ToolRegistry.GetString(request.Arguments, "regex"), "true", StringComparison.OrdinalIgnoreCase)
                       || (request.Arguments.TryGetValue("regex", out var rv) && rv is JsonElement je && je.ValueKind == JsonValueKind.True);
        var maxResults = Math.Min(ToolRegistry.GetInt(request.Arguments, "maxResults", Limits.MaxSearchResults), Limits.MaxSearchResults);

        var resolved = Paths.ResolveWithinRoot(root.AbsolutePath, path);
        if (!resolved.Allowed) return Task.FromResult(Deny(request, resolved));

        Regex? regex = null;
        if (useRegex)
        {
            try
            {
                regex = new Regex(query, RegexOptions.Compiled | RegexOptions.Multiline, TimeSpan.FromMilliseconds(200));
            }
            catch
            {
                return Task.FromResult(new LocalToolResult
                {
                    RequestId = request.Id,
                    Success = false,
                    Tool = Name,
                    Error = new ToolError { Code = "invalid_regex", Message = "Invalid or unsafe regex." }
                });
            }
        }

        var matches = new List<object>();
        var truncated = false;
        var filesScanned = 0;
        var startDir = Directory.Exists(resolved.FullPath) ? resolved.FullPath! : Path.GetDirectoryName(resolved.FullPath!)!;

        foreach (var file in Enumerate(startDir))
        {
            ct.ThrowIfCancellationRequested();
            filesScanned++;
            if (filesScanned > Limits.MaxSearchFiles) { truncated = true; break; }

            var rel = Path.GetRelativePath(root.AbsolutePath, file).Replace('\\', '/');
            var check = Paths.ResolveWithinRoot(root.AbsolutePath, rel);
            if (!check.Allowed) continue;
            if (!Glob(Path.GetFileName(file), filePattern)) continue;
            if (Paths.IsHardDeniedFile(Path.GetFileName(file))) continue;

            try
            {
                if (Binary.IsBinaryFile(file)) continue;
                var fi = new FileInfo(file);
                if (fi.Length > Limits.MaxTextFileBytes) continue;
                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    var line = lines[i];
                    bool hit = regex is not null ? regex.IsMatch(line) : line.Contains(query, StringComparison.Ordinal);
                    if (!hit) continue;
                    var snippet = Redaction.Redact(line);
                    if (snippet.Length > 400) snippet = snippet[..400];
                    matches.Add(new { path = rel, line = i + 1, text = snippet });
                    if (matches.Count >= maxResults) { truncated = true; break; }
                }
            }
            catch { /* skip unreadable */ }
            if (truncated) break;
        }

        return Task.FromResult(Ok(request, new { query, matches }, truncated));
    }

    private IEnumerable<string> Enumerate(string start)
    {
        var stack = new Stack<string>();
        stack.Push(start);
        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            IEnumerable<string> dirs = Array.Empty<string>();
            try { dirs = Directory.EnumerateDirectories(dir); } catch { }
            foreach (var d in dirs)
            {
                if (Paths.IsExcludedDirectoryName(Path.GetFileName(d))) continue;
                stack.Push(d);
            }
            IEnumerable<string> files = Array.Empty<string>();
            try { files = Directory.EnumerateFiles(dir); } catch { }
            foreach (var f in files) yield return f;
        }
    }

    private static bool Glob(string name, string pattern)
    {
        var regex = "^" + Regex.Escape(pattern).Replace("\\*", ".*").Replace("\\?", ".") + "$";
        return Regex.IsMatch(name, regex, RegexOptions.IgnoreCase);
    }
}

public sealed class ReadFileTool : ToolBase
{
    public ReadFileTool(PathSecurityService p, BridgeLimits l, SecretRedactionService r, BinaryDetectionService b, OutputTruncationService t) : base(p, l, r, b, t) { }
    public override string Name => "read_file";

    public override Task<LocalToolResult> ExecuteAsync(LocalToolRequest request, ApprovedRoot root, CancellationToken ct)
    {
        var path = ToolRegistry.GetString(request.Arguments, "path");
        if (string.IsNullOrEmpty(path))
            return Task.FromResult(new LocalToolResult
            {
                RequestId = request.Id,
                Success = false,
                Tool = Name,
                Error = new ToolError { Code = "missing_path", Message = "path is required." }
            });

        var resolved = Paths.ResolveWithinRoot(root.AbsolutePath, path);
        if (!resolved.Allowed) return Task.FromResult(Deny(request, resolved));

        string? correctedFrom = null;
        var fullPath = resolved.FullPath;
        var resultPath = resolved.RelativePath ?? path;

        if (!File.Exists(fullPath))
        {
            var fuzzy = FuzzyPathResolver.TryResolveExistingFile(root.AbsolutePath, path!, Paths);
            if (fuzzy is not null)
            {
                fullPath = fuzzy.FullPath;
                correctedFrom = fuzzy.CorrectedFrom;
                resultPath = fuzzy.RelativePath;
            }
            else
            {
                var suggestions = FuzzyPathResolver.Suggest(root.AbsolutePath, path!, Paths);
                var hint = suggestions.Count > 0
                    ? $"File not found. Did you mean: {string.Join(", ", suggestions.Take(3))}?"
                    : "File not found.";
                return Task.FromResult(new LocalToolResult
                {
                    RequestId = request.Id,
                    Success = false,
                    Tool = Name,
                    Error = new ToolError { Code = "not_found", Message = hint },
                    Data = suggestions.Count > 0 ? new { suggestions } : null
                });
            }
        }

        var fi = new FileInfo(fullPath!);
        if (fi.Length > Limits.MaxTextFileBytes)
            return Task.FromResult(new LocalToolResult
            {
                RequestId = request.Id,
                Success = false,
                Tool = Name,
                Error = new ToolError { Code = "file_too_large", Message = "File exceeds max text size." }
            });

        if (Binary.IsBinaryFile(fullPath!))
            return Task.FromResult(new LocalToolResult
            {
                RequestId = request.Id,
                Success = false,
                Tool = Name,
                Error = new ToolError { Code = "binary_file", Message = "Binary files cannot be read." }
            });

        var startLine = Math.Max(1, ToolRegistry.GetInt(request.Arguments, "startLine", 1));
        var maxLines = Math.Min(ToolRegistry.GetInt(request.Arguments, "maxLines", Limits.MaxReadLines), Limits.MaxReadLines);

        // Encoding: prefer UTF-8, allow UTF-8 BOM / fallback Latin1 detection lightly
        string text;
        using (var fs = File.OpenRead(fullPath!))
        using (var reader = new StreamReader(fs, Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
            text = reader.ReadToEnd();

        text = Redaction.Redact(text);
        var allLines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var slice = allLines.Skip(startLine - 1).Take(maxLines).ToList();
        var truncated = startLine - 1 + slice.Count < allLines.Length || Encoding.UTF8.GetByteCount(text) > Limits.MaxResultBytes / 2;
        var numbered = slice.Select((line, idx) => $"{startLine + idx}|{line}").ToList();
        var body = string.Join("\n", numbered);
        var (finalBody, trunc2) = Truncation.TruncateString(body, Limits.MaxResultBytes / 2);

        var warnings = new List<string>();
        if (correctedFrom is not null)
            warnings.Add($"path_corrected:{correctedFrom}->{resultPath}");

        return Task.FromResult(Ok(request, new
        {
            path = resultPath,
            startLine,
            lineCount = slice.Count,
            content = finalBody,
            correctedFrom
        }, truncated || trunc2, warnings));
    }
}

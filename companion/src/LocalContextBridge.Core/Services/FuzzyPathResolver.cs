using LocalContextBridge.Core.Security;

namespace LocalContextBridge.Core.Services;

/// <summary>
/// Suggests / auto-resolves near-miss relative paths inside an approved root
/// (e.g. pubspec.yml → pubspec.yaml) without escaping the root.
/// </summary>
public static class FuzzyPathResolver
{
    private static readonly (string From, string To)[] ExtensionAliases =
    [
        (".yml", ".yaml"),
        (".yaml", ".yml"),
        (".htm", ".html"),
        (".html", ".htm"),
        (".jpeg", ".jpg"),
        (".jpg", ".jpeg"),
        (".md", ".markdown"),
        (".markdown", ".md"),
        (".ts", ".tsx"),
        (".tsx", ".ts"),
        (".js", ".jsx"),
        (".jsx", ".js"),
    ];

    public sealed record ResolveResult(string RelativePath, string FullPath, string? CorrectedFrom);

    /// <summary>
    /// If <paramref name="requestedRelative"/> does not exist, try siblings and
    /// common extension aliases. Returns null when nothing close enough is found.
    /// </summary>
    public static ResolveResult? TryResolveExistingFile(
        string rootAbsolute,
        string requestedRelative,
        PathSecurityService paths,
        int maxSuggestions = 5)
    {
        var requested = requestedRelative.Replace('\\', '/').Trim();
        if (string.IsNullOrWhiteSpace(requested) || requested is "." or "./")
            return null;

        var direct = paths.ResolveWithinRoot(rootAbsolute, requested);
        if (direct.Allowed && File.Exists(direct.FullPath))
        {
            return new ResolveResult(NormalizeRel(rootAbsolute, direct.FullPath!), direct.FullPath!, null);
        }

        var parentRel = Path.GetDirectoryName(requested.Replace('/', Path.DirectorySeparatorChar)) ?? "";
        parentRel = parentRel.Replace('\\', '/');
        if (parentRel is "." ) parentRel = "";
        var leaf = Path.GetFileName(requested);
        if (string.IsNullOrEmpty(leaf)) return null;

        var parentResolved = paths.ResolveWithinRoot(rootAbsolute, string.IsNullOrEmpty(parentRel) ? "." : parentRel);
        if (!parentResolved.Allowed || !Directory.Exists(parentResolved.FullPath))
        {
            // Walk up looking for a close leaf name anywhere under root (bounded).
            return SearchByLeafName(rootAbsolute, leaf, paths, maxSuggestions);
        }

        string[] siblings;
        try
        {
            siblings = Directory.GetFiles(parentResolved.FullPath!);
        }
        catch
        {
            return null;
        }

        var best = PickBest(leaf, siblings.Select(Path.GetFileName).Where(n => n is not null).Cast<string>());
        if (best is null) return SearchByLeafName(rootAbsolute, leaf, paths, maxSuggestions);

        var candidateRel = string.IsNullOrEmpty(parentRel) ? best : $"{parentRel.TrimEnd('/')}/{best}";
        var candidate = paths.ResolveWithinRoot(rootAbsolute, candidateRel);
        if (!candidate.Allowed || !File.Exists(candidate.FullPath)) return null;
        if (paths.IsHardDeniedFile(best)) return null;

        return new ResolveResult(NormalizeRel(rootAbsolute, candidate.FullPath!), candidate.FullPath!, requested);
    }

    public static IReadOnlyList<string> Suggest(
        string rootAbsolute,
        string requestedRelative,
        PathSecurityService paths,
        int limit = 5)
    {
        var leaf = Path.GetFileName(requestedRelative.Replace('\\', '/'));
        if (string.IsNullOrEmpty(leaf)) return Array.Empty<string>();

        var hits = new List<(string Rel, int Score)>();
        foreach (var file in EnumerateFilesBounded(rootAbsolute, paths, 4000))
        {
            var name = Path.GetFileName(file);
            if (paths.IsHardDeniedFile(name)) continue;
            var score = Score(leaf, name);
            if (score <= 0) continue;
            hits.Add((NormalizeRel(rootAbsolute, file), score));
        }

        return hits
            .OrderByDescending(h => h.Score)
            .ThenBy(h => h.Rel.Length)
            .Take(limit)
            .Select(h => h.Rel)
            .ToList();
    }

    private static ResolveResult? SearchByLeafName(
        string rootAbsolute,
        string leaf,
        PathSecurityService paths,
        int maxSuggestions)
    {
        var suggestions = Suggest(rootAbsolute, leaf, paths, maxSuggestions);
        if (suggestions.Count == 0) return null;
        var top = suggestions[0];
        // Only auto-resolve when the top hit is clearly the intended file.
        var topName = Path.GetFileName(top);
        if (Score(leaf, topName) < 70) return null;
        var resolved = paths.ResolveWithinRoot(rootAbsolute, top);
        if (!resolved.Allowed || !File.Exists(resolved.FullPath)) return null;
        return new ResolveResult(top, resolved.FullPath!, leaf);
    }

    private static string? PickBest(string wanted, IEnumerable<string> candidates)
    {
        string? best = null;
        var bestScore = 0;
        foreach (var c in candidates)
        {
            var score = Score(wanted, c);
            if (score > bestScore)
            {
                bestScore = score;
                best = c;
            }
        }
        return bestScore >= 55 ? best : null;
    }

    /// <summary>Higher is better. 100 = exact ignore-case; extension alias ~90; edit distance otherwise.</summary>
    public static int Score(string wanted, string candidate)
    {
        if (string.Equals(wanted, candidate, StringComparison.OrdinalIgnoreCase))
            return 100;

        var wExt = Path.GetExtension(wanted);
        var cExt = Path.GetExtension(candidate);
        var wStem = Path.GetFileNameWithoutExtension(wanted);
        var cStem = Path.GetFileNameWithoutExtension(candidate);

        if (string.Equals(wStem, cStem, StringComparison.OrdinalIgnoreCase))
        {
            foreach (var (from, to) in ExtensionAliases)
            {
                if (string.Equals(wExt, from, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(cExt, to, StringComparison.OrdinalIgnoreCase))
                    return 92;
            }
            if (string.Equals(wExt, cExt, StringComparison.OrdinalIgnoreCase))
                return 88;
            return 70;
        }

        // Prefix / contains (pubspec → pubspec.yaml when extension omitted)
        if (candidate.StartsWith(wanted, StringComparison.OrdinalIgnoreCase) ||
            wanted.StartsWith(cStem, StringComparison.OrdinalIgnoreCase))
            return 75;

        var distance = Levenshtein(wanted.ToLowerInvariant(), candidate.ToLowerInvariant());
        var maxLen = Math.Max(wanted.Length, candidate.Length);
        if (maxLen == 0) return 0;
        var similarity = 1.0 - (double)distance / maxLen;
        if (similarity >= 0.75) return (int)(similarity * 80);
        return 0;
    }

    private static int Levenshtein(string a, string b)
    {
        var n = a.Length;
        var m = b.Length;
        var d = new int[n + 1, m + 1];
        for (var i = 0; i <= n; i++) d[i, 0] = i;
        for (var j = 0; j <= m; j++) d[0, j] = j;
        for (var i = 1; i <= n; i++)
        {
            for (var j = 1; j <= m; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                d[i, j] = Math.Min(
                    Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1),
                    d[i - 1, j - 1] + cost);
            }
        }
        return d[n, m];
    }

    private static IEnumerable<string> EnumerateFilesBounded(
        string rootAbsolute,
        PathSecurityService paths,
        int limit)
    {
        var count = 0;
        var stack = new Stack<string>();
        stack.Push(rootAbsolute);
        while (stack.Count > 0 && count < limit)
        {
            var dir = stack.Pop();
            IEnumerable<string> dirs = Array.Empty<string>();
            try { dirs = Directory.EnumerateDirectories(dir); } catch { /* skip */ }
            foreach (var d in dirs)
            {
                if (paths.IsExcludedDirectoryName(Path.GetFileName(d))) continue;
                stack.Push(d);
            }
            IEnumerable<string> files = Array.Empty<string>();
            try { files = Directory.EnumerateFiles(dir); } catch { /* skip */ }
            foreach (var f in files)
            {
                yield return f;
                count += 1;
                if (count >= limit) yield break;
            }
        }
    }

    private static string NormalizeRel(string rootAbsolute, string fullPath)
    {
        var root = Path.GetFullPath(rootAbsolute).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var full = Path.GetFullPath(fullPath);
        if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            var rel = full[root.Length..].TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return rel.Replace('\\', '/');
        }
        return Path.GetFileName(fullPath);
    }
}

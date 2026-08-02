using System.Text.RegularExpressions;

namespace LocalContextBridge.Core.Security;

public sealed class PathSecurityResult
{
    public bool Allowed { get; init; }
    public string? FullPath { get; init; }
    public string? RelativePath { get; init; }
    public string? ErrorCode { get; init; }
    public string? ErrorMessage { get; init; }

    public static PathSecurityResult Ok(string fullPath, string relativePath) =>
        new() { Allowed = true, FullPath = fullPath, RelativePath = relativePath };

    public static PathSecurityResult Deny(string code, string message) =>
        new() { Allowed = false, ErrorCode = code, ErrorMessage = message };
}

/// <summary>
/// Validates and canonicalizes untrusted, root-relative path strings supplied by tool callers,
/// and enforces the approved-root boundary, hard-denied credential files, and excluded
/// high-volume directories. Every public entry point fails closed: any ambiguity or filesystem
/// error results in denial rather than an assumption of safety.
/// </summary>
public sealed class PathSecurityService
{
    private static readonly HashSet<string> ExcludedDirectoryNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", "node_modules", "bin", "obj", "dist", "build", "coverage", "target",
        "vendor", ".idea", ".vs", "TestResults",
    };

    private static readonly string[] HardDenyExactFileNames =
    [
        ".npmrc", ".pypirc", "local.settings.json", "terraform.tfstate", "terraform.tfstate.backup",
        "kubeconfig", "credentials", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
        "id_rsa.pub", "id_dsa.pub", "id_ecdsa.pub", "id_ed25519.pub",
    ];

    private static readonly string[] HardDenyExtensions =
    [
        ".pem", ".key", ".pfx", ".p12", ".p7b", ".jks",
    ];

    private const int MaxSymlinkHops = 40;

    /// <summary>
    /// Resolves <paramref name="relativePath"/> (untrusted, root-relative) against
    /// <paramref name="rootAbsolutePath"/> (trusted, previously validated). Returns a denial for
    /// any absolute/UNC/URI/null-byte/traversal/malformed input, any attempt to escape the root
    /// (including via symlinks/junctions on intermediate path segments), and — when
    /// <paramref name="forRead"/> is true — any hard-denied credential file or excluded
    /// high-volume directory.
    /// </summary>
    public PathSecurityResult ResolveWithinRoot(string rootAbsolutePath, string? relativePath, bool forRead = true)
    {
        if (string.IsNullOrWhiteSpace(rootAbsolutePath))
        {
            return PathSecurityResult.Deny("invalid_root", "Root path is empty.");
        }

        string rootFull;
        try
        {
            rootFull = Path.GetFullPath(rootAbsolutePath);
        }
        catch
        {
            return PathSecurityResult.Deny("invalid_root", "Root path is invalid.");
        }

        if (!Directory.Exists(rootFull))
        {
            return PathSecurityResult.Deny("root_missing", "Approved root does not exist.");
        }

        var rel = string.IsNullOrWhiteSpace(relativePath) ? "." : relativePath;

        if (ContainsControlCharacters(rel))
        {
            return PathSecurityResult.Deny("control_characters", "Path contains control or null-byte characters.");
        }

        var decoded = TryPercentDecode(rel);
        if (decoded is null)
        {
            return PathSecurityResult.Deny("malformed_path", "Path contains malformed percent-encoding.");
        }

        if (ContainsControlCharacters(decoded) || decoded != rel && HasTraversal(decoded))
        {
            return PathSecurityResult.Deny("malformed_path", "Path contains hidden traversal or control characters.");
        }

        var normalized = rel.Replace('\\', '/');

        if (LooksLikeUri(normalized))
        {
            return PathSecurityResult.Deny("uri_path", "URI-qualified paths are not allowed.");
        }

        if (IsUnc(normalized))
        {
            return PathSecurityResult.Deny("unc_path", "UNC paths are not allowed.");
        }

        if (IsAbsoluteOrDriveQualified(normalized))
        {
            return PathSecurityResult.Deny("absolute_path", "Absolute or drive-qualified paths are not allowed; use root-relative paths.");
        }

        if (HasTraversal(normalized))
        {
            return PathSecurityResult.Deny("traversal", "Path traversal ('..') is not allowed.");
        }

        string combined;
        try
        {
            combined = Path.GetFullPath(Path.Combine(rootFull, normalized));
        }
        catch
        {
            return PathSecurityResult.Deny("malformed_path", "Path could not be resolved.");
        }

        var comparison = GetComparison(rootFull);

        if (!IsStrictlyWithinRoot(rootFull, combined, comparison))
        {
            return PathSecurityResult.Deny("outside_root", "Path escapes the approved root.");
        }

        string effective;
        string relativeBase = rootFull;
        try
        {
            if (File.Exists(combined) || Directory.Exists(combined))
            {
                // Resolve twice: an absolute symlink jump can land on a path that still
                // contains OS-level intermediate symlinks (e.g. macOS /var -> /private/var).
                var realRoot = CanonicalizeExistingPath(rootFull);
                var realCandidate = CanonicalizeExistingPath(combined);
                if (!IsStrictlyWithinRoot(realRoot, realCandidate, GetComparison(realRoot)))
                {
                    return PathSecurityResult.Deny("symlink_escape", "Symlink or junction escapes the approved root.");
                }

                effective = realCandidate;
                relativeBase = realRoot;
            }
            else
            {
                effective = combined;
            }
        }
        catch (InvalidOperationException)
        {
            return PathSecurityResult.Deny("symlink_resolve_failed", "Symlink chain too deep to resolve safely.");
        }
        catch (IOException)
        {
            return PathSecurityResult.Deny("symlink_resolve_failed", "Failed to resolve real path.");
        }
        catch (UnauthorizedAccessException)
        {
            return PathSecurityResult.Deny("symlink_resolve_failed", "Access denied while resolving real path.");
        }

        var relativeOut = Path.GetRelativePath(relativeBase, effective).Replace('\\', '/');
        if (relativeOut == ".")
        {
            relativeOut = string.Empty;
        }

        if (relativeOut.StartsWith("..", StringComparison.Ordinal))
        {
            return PathSecurityResult.Deny("outside_root", "Path escapes the approved root.");
        }

        if (forRead)
        {
            if (ContainsExcludedSegment(relativeOut))
            {
                return PathSecurityResult.Deny("excluded_directory", "Path is under an excluded directory.");
            }

            var fileName = Path.GetFileName(effective);
            if (IsHardDeniedFile(fileName))
            {
                return PathSecurityResult.Deny("hard_denied", "File is hard-denied for security reasons.");
            }
        }

        return PathSecurityResult.Ok(effective, relativeOut);
    }

    public bool IsExcludedDirectoryName(string name) => ExcludedDirectoryNames.Contains(name);

    public IReadOnlyCollection<string> ExcludedDirectoryNamesView => ExcludedDirectoryNames;

    public IReadOnlyCollection<string> HardDenyPatternsView =>
    [
        ".env*", "*.pem", "*.key", "*.pfx", "*.p12", "id_rsa*", "id_dsa*", "id_ecdsa*", "id_ed25519*",
        ".npmrc", ".pypirc", "local.settings.json", "terraform.tfstate*", "kubeconfig*", "credentials*",
    ];

    public bool IsHardDeniedFile(string fileName)
    {
        if (string.IsNullOrEmpty(fileName))
        {
            return false;
        }

        if (fileName.StartsWith(".env", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        foreach (var n in HardDenyExactFileNames)
        {
            if (fileName.Equals(n, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        if (fileName.Contains("kubeconfig", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (fileName.Contains("credentials", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (fileName.StartsWith("terraform.tfstate", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var ext = Path.GetExtension(fileName);
        foreach (var e in HardDenyExtensions)
        {
            if (ext.Equals(e, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>True when any segment of a root-relative path is a known excluded directory name.</summary>
    public bool ContainsExcludedSegment(string relativePath)
    {
        if (string.IsNullOrEmpty(relativePath))
        {
            return false;
        }

        var parts = relativePath.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
        return parts.Any(ExcludedDirectoryNames.Contains);
    }

    /// <summary>
    /// Boundary check between a candidate absolute path and a root absolute path. This is
    /// deliberately NOT a plain string-prefix check: "/home/user/project-evil" must not be
    /// considered inside "/home/user/project".
    /// </summary>
    public static bool IsStrictlyWithinRoot(string rootFullPath, string candidateFullPath) =>
        IsStrictlyWithinRoot(
            rootFullPath,
            candidateFullPath,
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    public static bool IsStrictlyWithinRoot(string rootFullPath, string candidateFullPath, StringComparison comparison)
    {
        var root = TrimSeparators(Path.GetFullPath(rootFullPath));
        var candidate = TrimSeparators(Path.GetFullPath(candidateFullPath));

        if (string.Equals(root, candidate, comparison))
        {
            return true;
        }

        if (candidate.Length <= root.Length || !candidate.StartsWith(root, comparison))
        {
            return false;
        }

        var next = candidate[root.Length];
        return next == Path.DirectorySeparatorChar || next == Path.AltDirectorySeparatorChar;
    }

    /// <summary>
    /// Determines whether the filesystem hosting <paramref name="existingPath"/> is case
    /// sensitive by probing the real filesystem (not by assuming based on operating system —
    /// APFS can be configured either way, and this must not "blindly lowercase" on macOS).
    /// </summary>
    public static StringComparison GetComparison(string existingPath) =>
        IsCaseSensitiveFileSystem(existingPath) ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;

    public static bool IsCaseSensitiveFileSystem(string existingPath)
    {
        try
        {
            var normalized = TrimSeparators(Path.GetFullPath(existingPath));
            var parent = Path.GetDirectoryName(normalized);
            var leaf = Path.GetFileName(normalized);

            if (string.IsNullOrEmpty(leaf) || parent is null || !Directory.Exists(parent))
            {
                // No parent to probe against (e.g. filesystem root); default to case-sensitive,
                // the safer (stricter) assumption when we cannot verify.
                return true;
            }

            var swappedLeaf = SwapCase(leaf);
            if (swappedLeaf == leaf)
            {
                // No alphabetic characters to toggle; cannot determine, default to strict.
                return true;
            }

            var swappedFullPath = Path.Combine(parent, swappedLeaf);
            var existsUnderSwappedCase = Directory.Exists(swappedFullPath) || File.Exists(swappedFullPath);
            return !existsUnderSwappedCase;
        }
        catch
        {
            return true;
        }
    }

    private static string SwapCase(string value)
    {
        var chars = value.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (char.IsUpper(chars[i]))
            {
                chars[i] = char.ToLowerInvariant(chars[i]);
            }
            else if (char.IsLower(chars[i]))
            {
                chars[i] = char.ToUpperInvariant(chars[i]);
            }
        }

        return new string(chars);
    }

    private static string TrimSeparators(string p) =>
        p.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

    private static bool ContainsControlCharacters(string path) =>
        path.Any(c => c < 0x20 || c == 0x7F);

    private static string? TryPercentDecode(string path)
    {
        if (!path.Contains('%'))
        {
            return path;
        }

        try
        {
            return Uri.UnescapeDataString(path);
        }
        catch
        {
            return null;
        }
    }

    private static bool LooksLikeUri(string path) =>
        Regex.IsMatch(path, @"^[a-zA-Z][a-zA-Z0-9+.\-]*:", RegexOptions.None, TimeSpan.FromMilliseconds(50)) &&
        !Regex.IsMatch(path, @"^[A-Za-z]:[/\\]", RegexOptions.None, TimeSpan.FromMilliseconds(50));

    private static bool IsUnc(string path) =>
        path.StartsWith("//", StringComparison.Ordinal) ||
        path.StartsWith(@"\\", StringComparison.Ordinal);

    private static bool IsAbsoluteOrDriveQualified(string path)
    {
        if (path.StartsWith('/') || path.StartsWith('\\'))
        {
            return true;
        }

        if (path.Length >= 2 && char.IsLetter(path[0]) && path[1] == ':')
        {
            return true;
        }

        return false;
    }

    private static bool HasTraversal(string path)
    {
        var parts = path.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
        return parts.Any(p => p == "..");
    }

    /// <summary>
    /// Resolves the real (symlink-free) path by walking each path component and resolving
    /// symlinks progressively, so an intermediate directory symlink (not just the final
    /// component) cannot be used to escape the approved root.
    /// </summary>
    internal static string ResolveRealPath(string path)
    {
        var full = Path.GetFullPath(path);
        var root = Path.GetPathRoot(full);
        if (string.IsNullOrEmpty(root))
        {
            return full;
        }

        var segments = full[root.Length..]
            .Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);

        // Keep the root exactly as returned by Path.GetPathRoot (e.g. "/" or "C:\") so that
        // Path.Combine does not misinterpret a trimmed drive root as a drive-relative segment.
        var current = root;

        foreach (var segment in segments)
        {
            current = Path.Combine(current, segment);
            current = ResolveSegmentLinkChain(current);
        }

        return Path.GetFullPath(current);
    }

    /// <summary>
    /// Fully canonicalize an existing path, including a second pass so absolute symlink
    /// targets that still contain OS intermediate links (macOS /var) are expanded.
    /// </summary>
    private static string CanonicalizeExistingPath(string path)
    {
        var once = ResolveRealPath(path);
        return ResolveRealPath(once);
    }

    private static string ResolveSegmentLinkChain(string current)
    {
        var hops = 0;
        while (hops++ < MaxSymlinkHops)
        {
            FileSystemInfo? link;
            try
            {
                link = File.ResolveLinkTarget(current, returnFinalTarget: false);
            }
            catch (IOException)
            {
                return current;
            }
            catch (UnauthorizedAccessException)
            {
                return current;
            }
            catch (NotSupportedException)
            {
                return current;
            }

            if (link is null)
            {
                return current;
            }

            current = link.FullName;
        }

        throw new InvalidOperationException("Symlink chain exceeded maximum depth.");
    }
}

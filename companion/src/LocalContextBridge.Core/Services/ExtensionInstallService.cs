using System.Diagnostics;
using System.Text.Json;

namespace LocalContextBridge.Core.Services;

/// <summary>
/// Detect / help install the Chrome extension.
/// Chrome blocks silent / External-Extensions CRX installs ("not added by you").
/// The supported path is Load unpacked — we open chrome://extensions, reveal the
/// bundled folder, and guide one Load unpacked confirmation.
/// </summary>
public sealed class ExtensionInstallService
{
    private readonly string _dataDirectory;
    public const string PinnedExtensionId = "cbpoofaeifiplkedkndehafpnghoalce";

    public ExtensionInstallService(string dataDirectory)
    {
        _dataDirectory = dataDirectory;
    }

    /// <summary>True when the bridge extension is present and enabled in a Chrome profile.</summary>
    public bool IsInstalled()
    {
        foreach (var profileDir in EnumerateChromeProfileDirs())
        {
            if (IsEnabledInProfile(profileDir)) return true;
        }
        return false;
    }

    public InstallResult Install(string? preferredCrxPath = null, string version = "0.1.0")
    {
        _ = preferredCrxPath;
        _ = version;

        // Stop Chrome from re-trying the blocked External Extensions path.
        ClearExternalExtensionsRegistration();

        if (IsInstalled())
        {
            // Refresh staged unpacked copy so Load unpacked / Finder reveal stay current.
            _ = StageUnpackedExtension();
            return new InstallResult(true, true, "Extension already installed and enabled in Chrome.", ResolveStableDistPath());
        }

        var dist = StageUnpackedExtension();
        if (dist is null)
            return new InstallResult(false, false, "Bundled extension/dist folder not found. Rebuild the Bridge app.", null);

        OpenChromeExtensionsPage();
        RevealExtensionFolder(dist);
        ShowLoadUnpackedInstructions(dist);

        return new InstallResult(
            false,
            false,
            "Chrome cannot silently add local extensions. In chrome://extensions: enable Developer mode → Load unpacked → select the folder highlighted in Finder.",
            dist);
    }

    public void OpenChromeExtensionsPage()
    {
        if (!OperatingSystem.IsMacOS()) return;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "open",
                ArgumentList = { "-a", "Google Chrome", "chrome://extensions" },
                UseShellExecute = false
            });
        }
        catch { /* ignore */ }
    }

    public void RevealExtensionFolder(string? distPath = null)
    {
        if (!OperatingSystem.IsMacOS()) return;
        var path = distPath ?? ResolveStableDistPath() ?? ResolveDistPath();
        if (path is null || !Directory.Exists(path)) return;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "open",
                ArgumentList = { "-R", path },
                UseShellExecute = false
            });
        }
        catch { /* ignore */ }
    }

    private void ClearExternalExtensionsRegistration()
    {
        try
        {
            var jsonPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Library", "Application Support", "Google", "Chrome", "External Extensions",
                $"{PinnedExtensionId}.json");
            if (File.Exists(jsonPath)) File.Delete(jsonPath);
        }
        catch { /* ignore */ }
    }

    private string? StageUnpackedExtension()
    {
        var source = ResolveDistPath();
        if (source is null) return null;

        var dest = Path.Combine(_dataDirectory, "extension-dist");
        try
        {
            if (Directory.Exists(dest))
                Directory.Delete(dest, recursive: true);
            CopyDirectory(source, dest);
            return dest;
        }
        catch
        {
            // Fall back to reading the package folder directly.
            return source;
        }
    }

    private string? ResolveStableDistPath()
    {
        var staged = Path.Combine(_dataDirectory, "extension-dist");
        if (Directory.Exists(staged) && File.Exists(Path.Combine(staged, "manifest.json")))
            return staged;
        return ResolveDistPath();
    }

    private static void ShowLoadUnpackedInstructions(string distPath)
    {
        if (!OperatingSystem.IsMacOS()) return;
        var escaped = distPath.Replace("\\", "\\\\").Replace("\"", "\\\"");
        var script =
            $"display dialog \"Chrome blocked auto-install (extensions must be added by you).\" & return & return & " +
            $"\"1. If Local Context Bridge appears disabled, remove it.\" & return & " +
            $"\"2. Turn on Developer mode (top-right).\" & return & " +
            $"\"3. Click Load unpacked.\" & return & " +
            $"\"4. Choose this folder (already highlighted in Finder):\" & return & return & " +
            $"\"{escaped}\" buttons {{\"OK\"}} default button 1 with title \"Add Local Context Bridge\"";
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "osascript",
                ArgumentList = { "-e", script },
                UseShellExecute = false
            });
        }
        catch { /* ignore */ }
    }

    private static bool IsEnabledInProfile(string profileDir)
    {
        // Preferences may be stale while Chrome is running; also check Secure Preferences.
        foreach (var fileName in new[] { "Preferences", "Secure Preferences" })
        {
            var prefsPath = Path.Combine(profileDir, fileName);
            if (!File.Exists(prefsPath)) continue;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(prefsPath));
                if (!doc.RootElement.TryGetProperty("extensions", out var extensions)) continue;
                if (!extensions.TryGetProperty("settings", out var settings)) continue;

                // Preferred: pinned id from manifest key.
                if (settings.TryGetProperty(PinnedExtensionId, out var pinned) &&
                    IsExtensionEntryEnabled(pinned))
                    return true;

                // Fallback: any entry named Local Context Bridge (Load unpacked without key, or other profile).
                foreach (var prop in settings.EnumerateObject())
                {
                    if (!LooksLikeBridgeExtension(prop.Value)) continue;
                    if (IsExtensionEntryEnabled(prop.Value)) return true;
                }
            }
            catch
            {
                /* try next file */
            }
        }

        return false;
    }

    private static bool LooksLikeBridgeExtension(JsonElement entry)
    {
        if (entry.TryGetProperty("manifest", out var manifest))
        {
            if (manifest.TryGetProperty("name", out var name) &&
                (name.GetString() ?? "").Contains("Local Context Bridge", StringComparison.OrdinalIgnoreCase))
                return true;
        }
        if (entry.TryGetProperty("path", out var pathEl))
        {
            var path = pathEl.GetString() ?? "";
            if (path.Contains("local-context-bridge", StringComparison.OrdinalIgnoreCase) ||
                path.Contains("extension-dist", StringComparison.OrdinalIgnoreCase) ||
                path.Contains("extension/dist", StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    private static bool IsExtensionEntryEnabled(JsonElement entry)
    {
        // state: 1 = enabled, 0 = disabled (Chrome internal).
        if (entry.TryGetProperty("state", out var state) && state.TryGetInt32(out var stateVal))
        {
            if (stateVal != 1) return false;
        }

        if (entry.TryGetProperty("disable_reasons", out var reasons))
        {
            if (reasons.ValueKind == JsonValueKind.Array && reasons.GetArrayLength() > 0)
                return false;
            if (reasons.ValueKind == JsonValueKind.Number && reasons.GetInt32() != 0)
                return false;
            if (reasons.ValueKind == JsonValueKind.Object)
            {
                foreach (var _ in reasons.EnumerateObject())
                    return false;
            }
        }

        return true;
    }

    private static IEnumerable<string> EnumerateChromeProfileDirs()
    {
        var chrome = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Library", "Application Support", "Google", "Chrome");
        if (!Directory.Exists(chrome)) yield break;

        var def = Path.Combine(chrome, "Default");
        if (Directory.Exists(def)) yield return def;

        foreach (var dir in Directory.EnumerateDirectories(chrome, "Profile *"))
            yield return dir;
    }

    private static string? ResolveDistPath()
    {
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            // Staged next to the companion binary
            Path.Combine(baseDir, "extension", "dist"),
            Path.Combine(baseDir, "extension-dist"),
            // .app: Resources/native/macos-arm64 → Resources/extension/dist
            // repo: native/macos-arm64 → extension/dist
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "extension", "dist")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "extension", "dist")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "Resources", "extension", "dist")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "extension", "dist")),
        };
        foreach (var c in candidates)
        {
            try
            {
                if (Directory.Exists(c) && File.Exists(Path.Combine(c, "manifest.json")))
                    return c;
            }
            catch { /* ignore */ }
        }
        return null;
    }

    private static void CopyDirectory(string source, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.EnumerateFiles(source))
        {
            var name = Path.GetFileName(file);
            File.Copy(file, Path.Combine(dest, name), overwrite: true);
        }
        foreach (var dir in Directory.EnumerateDirectories(source))
        {
            var name = Path.GetFileName(dir);
            CopyDirectory(dir, Path.Combine(dest, name));
        }
    }
}

public sealed record InstallResult(bool Installed, bool AlreadyPresent, string Message, string? CrxPath);

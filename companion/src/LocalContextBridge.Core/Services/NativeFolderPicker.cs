using System.Diagnostics;
using System.Text;

namespace LocalContextBridge.Core.Services;

/// <summary>
/// Opens a native OS folder dialog. Chrome extensions cannot obtain real disk
/// paths from <c>showDirectoryPicker</c>, so the companion (a local process)
/// owns the picker and returns an absolute path to the extension.
/// </summary>
public static class NativeFolderPicker
{
    public static string? PickFolder(string prompt = "Select a folder for Local Context Bridge")
    {
        if (OperatingSystem.IsMacOS())
            return PickMacOs(prompt);
        if (OperatingSystem.IsWindows())
            return PickWindows(prompt);
        if (OperatingSystem.IsLinux())
            return PickLinux(prompt);
        return null;
    }

    private static string? PickMacOs(string prompt)
    {
        var escaped = prompt.Replace("\\", "\\\\").Replace("\"", "\\\"");
        var script = $"POSIX path of (choose folder with prompt \"{escaped}\")";
        var result = RunCapture("osascript", ["-e", script]);
        if (result is null) return null;
        var path = result.Trim();
        return Directory.Exists(path) ? Path.GetFullPath(path) : null;
    }

    private static string? PickWindows(string prompt)
    {
        // PowerShell FolderBrowserDialog — works without WinForms package refs.
        var ps = $$"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = @'
{{prompt.Replace("'", "''")}}
'@
$d.ShowNewFolderButton = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $d.SelectedPath
}
""";
        var result = RunCapture("powershell", ["-NoProfile", "-STA", "-Command", ps]);
        if (result is null) return null;
        var path = result.Trim();
        return Directory.Exists(path) ? Path.GetFullPath(path) : null;
    }

    private static string? PickLinux(string prompt)
    {
        var result = RunCapture("zenity", ["--file-selection", "--directory", $"--title={prompt}"])
            ?? RunCapture("kdialog", ["--getexistingdirectory", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)]);
        if (result is null) return null;
        var path = result.Trim();
        return Directory.Exists(path) ? Path.GetFullPath(path) : null;
    }

    private static string? RunCapture(string fileName, IReadOnlyList<string> args)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var proc = Process.Start(psi);
            if (proc is null) return null;
            var stdout = new StringBuilder();
            proc.OutputDataReceived += (_, e) =>
            {
                if (e.Data is not null) stdout.AppendLine(e.Data);
            };
            proc.BeginOutputReadLine();
            // Folder dialogs can sit open for a while.
            if (!proc.WaitForExit(5 * 60_000))
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
                return null;
            }
            if (proc.ExitCode != 0) return null;
            var text = stdout.ToString().Trim();
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }
        catch
        {
            return null;
        }
    }
}

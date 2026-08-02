using FluentAssertions;
using LocalContextBridge.Core.Security;
using Xunit;

namespace LocalContextBridge.Core.Tests;

public sealed class PathSecurityServiceTests : IDisposable
{
    private readonly string _root;
    private readonly PathSecurityService _service = new();

    public PathSecurityServiceTests()
    {
        _root = Directory.CreateTempSubdirectory("lcb-path-tests-").FullName;
        Directory.CreateDirectory(Path.Combine(_root, "src"));
        Directory.CreateDirectory(Path.Combine(_root, "node_modules", "pkg"));
        Directory.CreateDirectory(Path.Combine(_root, ".git"));
        File.WriteAllText(Path.Combine(_root, "src", "main.cs"), "// hello");
        File.WriteAllText(Path.Combine(_root, "node_modules", "pkg", "index.js"), "module.exports = {}");
        File.WriteAllText(Path.Combine(_root, ".git", "config"), "[core]");
        File.WriteAllText(Path.Combine(_root, ".env"), "SECRET=1");
        File.WriteAllText(Path.Combine(_root, "id_rsa"), "-----BEGIN OPENSSH PRIVATE KEY-----");
        File.WriteAllText(Path.Combine(_root, "server.pem"), "cert");
        File.WriteAllText(Path.Combine(_root, "kubeconfig.yaml"), "apiVersion: v1");
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch
        {
            // Best-effort cleanup only.
        }
    }

    [Fact]
    public void Allows_simple_relative_path_within_root()
    {
        var result = _service.ResolveWithinRoot(_root, "src/main.cs");

        result.Allowed.Should().BeTrue();
        result.RelativePath.Should().Be("src/main.cs");
    }

    [Fact]
    public void Allows_root_itself_via_empty_or_dot_path()
    {
        _service.ResolveWithinRoot(_root, "").Allowed.Should().BeTrue();
        _service.ResolveWithinRoot(_root, ".").Allowed.Should().BeTrue();
    }

    [Theory]
    [InlineData("/etc/passwd")]
    [InlineData("/absolute/unix/path")]
    public void Rejects_posix_absolute_paths(string path)
    {
        var result = _service.ResolveWithinRoot(_root, path);

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().Be("absolute_path");
    }

    [Theory]
    [InlineData(@"C:\Windows\System32\config")]
    [InlineData("C:/Windows/System32")]
    [InlineData("D:relative-to-drive")]
    public void Rejects_windows_drive_qualified_paths(string path)
    {
        var result = _service.ResolveWithinRoot(_root, path);

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().BeOneOf("absolute_path", "uri_path");
    }

    [Theory]
    [InlineData(@"\\server\share\file.txt")]
    [InlineData("//server/share")]
    public void Rejects_unc_paths(string path)
    {
        var result = _service.ResolveWithinRoot(_root, path);

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().BeOneOf("unc_path", "absolute_path");
    }

    [Theory]
    [InlineData("file:///etc/passwd")]
    [InlineData("http://evil.example.com/x")]
    [InlineData("ftp://host/resource")]
    public void Rejects_uri_qualified_paths(string path)
    {
        var result = _service.ResolveWithinRoot(_root, path);

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().Be("uri_path");
    }

    [Fact]
    public void Rejects_null_byte_in_path()
    {
        var result = _service.ResolveWithinRoot(_root, "src/main.cs\0.txt");

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().Be("control_characters");
    }

    [Theory]
    [InlineData("../outside.txt")]
    [InlineData("a/../../outside.txt")]
    [InlineData("..\\..\\windows\\system32")]
    [InlineData("src/../../etc/passwd")]
    public void Rejects_traversal_sequences(string path)
    {
        var result = _service.ResolveWithinRoot(_root, path);

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().Be("traversal");
    }

    [Fact]
    public void Rejects_percent_encoded_traversal()
    {
        var result = _service.ResolveWithinRoot(_root, "%2e%2e/%2e%2e/etc/passwd");

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().BeOneOf("traversal", "malformed_path");
    }

    [Fact]
    public void Handles_mixed_separators_for_a_real_nested_path()
    {
        Directory.CreateDirectory(Path.Combine(_root, "src", "nested"));
        File.WriteAllText(Path.Combine(_root, "src", "nested", "file.txt"), "x");

        var result = _service.ResolveWithinRoot(_root, "src\\nested/file.txt");

        result.Allowed.Should().BeTrue();
        result.RelativePath.Should().Be("src/nested/file.txt");
    }

    [Fact]
    public void Boundary_check_is_not_a_naive_string_prefix_match()
    {
        var sibling = _root + "-evil";
        Directory.CreateDirectory(sibling);
        try
        {
            var comparison = PathSecurityService.GetComparison(_root);

            PathSecurityService.IsStrictlyWithinRoot(_root, Path.Combine(sibling, "secret.txt"), comparison).Should().BeFalse();
            PathSecurityService.IsStrictlyWithinRoot(_root, Path.Combine(_root, "src", "main.cs"), comparison).Should().BeTrue();
            PathSecurityService.IsStrictlyWithinRoot(_root, _root, comparison).Should().BeTrue();
        }
        finally
        {
            Directory.Delete(sibling, recursive: true);
        }
    }

    [Fact]
    public void Rejects_symlinked_directory_that_escapes_the_root()
    {
        var outside = Directory.CreateTempSubdirectory("lcb-outside-").FullName;
        try
        {
            File.WriteAllText(Path.Combine(outside, "secret.txt"), "top secret");
            var linkPath = Path.Combine(_root, "escape-link");

            if (!TryCreateDirectorySymlink(linkPath, outside))
            {
                return; // symlinks unsupported in this environment; nothing more to assert.
            }

            var result = _service.ResolveWithinRoot(_root, "escape-link/secret.txt");

            result.Allowed.Should().BeFalse();
            result.ErrorCode.Should().Be("symlink_escape");
        }
        finally
        {
            Directory.Delete(outside, recursive: true);
        }
    }

    [Fact]
    public void Allows_symlinked_directory_that_stays_within_the_root()
    {
        var real = Path.Combine(_root, "real-target");
        Directory.CreateDirectory(real);
        File.WriteAllText(Path.Combine(real, "file.txt"), "ok");
        var linkPath = Path.Combine(_root, "inside-link");

        if (!TryCreateDirectorySymlink(linkPath, real))
        {
            return;
        }

        var result = _service.ResolveWithinRoot(_root, "inside-link/file.txt");

        result.Allowed.Should().BeTrue($"denied as {result.ErrorCode}: {result.ErrorMessage}");
        result.RelativePath.Should().BeOneOf("real-target/file.txt", "inside-link/file.txt");
    }

    [Theory]
    [InlineData(".env")]
    [InlineData("id_rsa")]
    [InlineData("server.pem")]
    [InlineData("kubeconfig.yaml")]
    public void Hard_denies_credential_files_even_inside_the_root(string relativePath)
    {
        var result = _service.ResolveWithinRoot(_root, relativePath, forRead: true);

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().Be("hard_denied");
    }

    [Theory]
    [InlineData(".env.local")]
    [InlineData(".env.production")]
    [InlineData("id_rsa.pub")]
    [InlineData("service.p12")]
    [InlineData("app.pfx")]
    [InlineData(".npmrc")]
    [InlineData(".pypirc")]
    [InlineData("local.settings.json")]
    [InlineData("terraform.tfstate")]
    [InlineData("aws-credentials.json")]
    public void Hard_deny_covers_full_pattern_family(string fileName)
    {
        _service.IsHardDeniedFile(fileName).Should().BeTrue();
    }

    [Theory]
    [InlineData("node_modules/pkg/index.js")]
    [InlineData(".git/config")]
    public void Excludes_high_volume_directories_from_read(string relativePath)
    {
        var result = _service.ResolveWithinRoot(_root, relativePath, forRead: true);

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().Be("excluded_directory");
    }

    [Fact]
    public void Rejects_when_root_does_not_exist()
    {
        var missingRoot = Path.Combine(_root, "does-not-exist");
        var result = _service.ResolveWithinRoot(missingRoot, "file.txt");

        result.Allowed.Should().BeFalse();
        result.ErrorCode.Should().Be("root_missing");
    }

    [Fact]
    public void Case_sensitivity_detection_matches_actual_filesystem_behavior()
    {
        var probeDir = Path.Combine(_root, "CaseProbe");
        Directory.CreateDirectory(probeDir);

        var swapped = Path.Combine(_root, "cASEpROBE");
        var actuallyInsensitive = Directory.Exists(swapped);

        PathSecurityService.IsCaseSensitiveFileSystem(probeDir).Should().Be(!actuallyInsensitive);
    }

    private static bool TryCreateDirectorySymlink(string linkPath, string targetPath)
    {
        try
        {
            Directory.CreateSymbolicLink(linkPath, targetPath);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            return false;
        }
    }
}

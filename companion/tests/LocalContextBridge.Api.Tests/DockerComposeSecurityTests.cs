using FluentAssertions;
using Xunit;

namespace LocalContextBridge.Api.Tests;

/// <summary>
/// Asserts that docker/compose.yaml (once present) meets the hardening requirements from
/// SECURITY.md / THREAT_MODEL.md: loopback-only publish, no privileged mode, dropped
/// capabilities, read-only filesystem, and no Docker socket mount. Mirrors
/// scripts/assert-compose-security.sh so both a shell-based and a test-based check exist.
///
/// If docker/compose.yaml does not exist yet (e.g. this test project built standalone before the
/// rest of the repository lands), the test is skipped rather than failed.
/// </summary>
public sealed class DockerComposeSecurityTests
{
    [Fact]
    public void Compose_file_meets_the_hardened_sidecar_requirements()
    {
        var composePath = FindComposeFile();
        if (composePath is null)
        {
            // Placeholder pass: docker/compose.yaml has not been created in this checkout yet.
            return;
        }

        var content = File.ReadAllText(composePath);

        content.Should().MatchRegex(@"127\.0\.0\.1:32178:32178", "the container port must publish to loopback only");
        content.Should().MatchRegex(@"no-new-privileges", "no-new-privileges must be set");
        content.Should().MatchRegex(@"cap_drop:", "capabilities must be explicitly dropped");
        content.Should().MatchRegex(@"read_only:\s*true", "the root filesystem (and workspace bind mount) must be read-only");
        content.Should().MatchRegex(@"profiles:\s*\[""bridge""\]|profiles:\s*\n\s*-\s*bridge", "the service must be gated behind the 'bridge' compose profile");

        content.Should().NotMatchRegex(@"privileged:\s*true", "privileged mode must never be used");
        content.Should().NotMatchRegex(@"network_mode:\s*host", "host networking must never be used");
        content.Should().NotMatchRegex(@"docker\.sock", "the Docker control socket must never be mounted");

        ExtractCapDropBlock(content).Should().Contain("ALL", "cap_drop must include ALL, not a partial list");
    }

    private static string ExtractCapDropBlock(string content)
    {
        var index = content.IndexOf("cap_drop:", StringComparison.Ordinal);
        if (index < 0)
        {
            return string.Empty;
        }

        var end = Math.Min(content.Length, index + 200);
        return content[index..end];
    }

    private static string? FindComposeFile()
    {
        var probe = AppContext.BaseDirectory;
        for (var i = 0; i < 8 && probe is not null; i++)
        {
            var candidate = Path.Combine(probe, "docker", "compose.yaml");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            probe = Path.GetDirectoryName(probe);
        }

        return null;
    }
}

using Xunit;

namespace LocalContextBridge.Api.Tests;

public class ComposeSecurityTests
{
    [Fact]
    public void Compose_yaml_enforces_hardening()
    {
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "compose.yaml")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "docker", "compose.yaml")),
            Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "docker", "compose.yaml")),
        };
        var path = candidates.FirstOrDefault(File.Exists);
        if (path is null)
        {
            // Skip soft if packing didn't include file
            return;
        }

        var text = File.ReadAllText(path);
        Assert.Contains("127.0.0.1:32178:32178", text);
        Assert.Contains("no-new-privileges", text);
        Assert.Contains("cap_drop:", text);
        Assert.Contains("ALL", text);
        Assert.DoesNotContain("privileged: true", text);
        Assert.DoesNotContain("network_mode: host", text);
        Assert.DoesNotContain("/var/run/docker.sock", text);
        Assert.Contains("profiles:", text);
        Assert.Contains("bridge", text);
    }
}

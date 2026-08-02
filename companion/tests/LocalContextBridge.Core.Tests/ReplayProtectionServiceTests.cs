using FluentAssertions;
using LocalContextBridge.Core.Security;
using Xunit;

namespace LocalContextBridge.Core.Tests;

public sealed class ReplayProtectionServiceTests
{
    [Fact]
    public void Accepts_a_fresh_request()
    {
        var service = new ReplayProtectionService();

        var accepted = service.TryAccept("nonce-1", "req-1", "hash-1", DateTimeOffset.UtcNow, skewSeconds: 60, out var error);

        accepted.Should().BeTrue();
        error.Should().BeEmpty();
    }

    [Fact]
    public void Rejects_a_reused_nonce()
    {
        var service = new ReplayProtectionService();
        var now = DateTimeOffset.UtcNow;

        service.TryAccept("nonce-dup", "req-1", "hash-1", now, 60, out _).Should().BeTrue();
        var replayed = service.TryAccept("nonce-dup", "req-2", "hash-2", now, 60, out var error);

        replayed.Should().BeFalse();
        error.Should().Be("replay_nonce");
    }

    [Fact]
    public void Rejects_a_duplicate_request_id()
    {
        var service = new ReplayProtectionService();
        var now = DateTimeOffset.UtcNow;

        service.TryAccept("nonce-1", "req-dup", "hash-1", now, 60, out _).Should().BeTrue();
        var duplicated = service.TryAccept("nonce-2", "req-dup", "hash-2", now, 60, out var error);

        duplicated.Should().BeFalse();
        error.Should().Be("duplicate_request_id");
    }

    [Fact]
    public void Rejects_a_duplicate_payload_hash()
    {
        var service = new ReplayProtectionService();
        var now = DateTimeOffset.UtcNow;

        service.TryAccept("nonce-1", "req-1", "hash-dup", now, 60, out _).Should().BeTrue();
        var duplicated = service.TryAccept("nonce-2", "req-2", "hash-dup", now, 60, out var error);

        duplicated.Should().BeFalse();
        error.Should().Be("duplicate_payload");
    }

    [Fact]
    public void Rejects_a_timestamp_outside_the_allowed_skew_window()
    {
        var service = new ReplayProtectionService();
        var stale = DateTimeOffset.UtcNow.AddMinutes(-10);

        var accepted = service.TryAccept("nonce-1", "req-1", "hash-1", stale, skewSeconds: 60, out var error);

        accepted.Should().BeFalse();
        error.Should().Be("timestamp_out_of_range");
    }

    [Fact]
    public void Rejects_a_timestamp_too_far_in_the_future()
    {
        var service = new ReplayProtectionService();
        var future = DateTimeOffset.UtcNow.AddMinutes(10);

        var accepted = service.TryAccept("nonce-1", "req-1", "hash-1", future, skewSeconds: 60, out var error);

        accepted.Should().BeFalse();
        error.Should().Be("timestamp_out_of_range");
    }

    [Fact]
    public void Sha256Hex_is_deterministic_and_case_sensitive_to_input()
    {
        var a = ReplayProtectionService.Sha256Hex("payload-a");
        var b = ReplayProtectionService.Sha256Hex("payload-a");
        var c = ReplayProtectionService.Sha256Hex("payload-b");

        a.Should().Be(b);
        a.Should().NotBe(c);
        a.Should().MatchRegex("^[0-9a-f]{64}$");
    }
}

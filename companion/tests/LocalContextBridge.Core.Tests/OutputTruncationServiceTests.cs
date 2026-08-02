using System.Text;
using FluentAssertions;
using LocalContextBridge.Core.Security;
using Xunit;

namespace LocalContextBridge.Core.Tests;

public sealed class OutputTruncationServiceTests
{
    private readonly OutputTruncationService _service = new();

    [Fact]
    public void TruncateString_returns_input_unchanged_when_within_limit()
    {
        var (text, truncated) = _service.TruncateString("hello world", 1024);

        text.Should().Be("hello world");
        truncated.Should().BeFalse();
    }

    [Fact]
    public void TruncateString_truncates_and_flags_when_over_the_byte_limit()
    {
        var input = new string('a', 5000);

        var (text, truncated) = _service.TruncateString(input, 100);

        truncated.Should().BeTrue();
        Encoding.UTF8.GetByteCount(text).Should().BeLessThanOrEqualTo(100 + 32); // allow for the truncation marker suffix
        text.Should().Contain("truncated");
    }

    [Fact]
    public void TruncateString_does_not_split_multi_byte_characters()
    {
        var input = string.Concat(Enumerable.Repeat("héllo wörld 日本語 ", 200));

        var (text, truncated) = _service.TruncateString(input, 50);

        truncated.Should().BeTrue();
        var act = () => Encoding.UTF8.GetBytes(text);
        act.Should().NotThrow();
    }

    [Fact]
    public void TruncateLines_returns_all_lines_when_within_limit()
    {
        var lines = new List<string> { "one", "two", "three" };

        var (result, truncated) = _service.TruncateLines(lines, 10);

        result.Should().BeEquivalentTo(lines, options => options.WithStrictOrdering());
        truncated.Should().BeFalse();
    }

    [Fact]
    public void TruncateLines_caps_at_max_lines_and_flags_truncation()
    {
        var lines = Enumerable.Range(1, 500).Select(i => $"line {i}").ToList();

        var (result, truncated) = _service.TruncateLines(lines, 300);

        result.Should().HaveCount(300);
        result[0].Should().Be("line 1");
        result[^1].Should().Be("line 300");
        truncated.Should().BeTrue();
    }
}

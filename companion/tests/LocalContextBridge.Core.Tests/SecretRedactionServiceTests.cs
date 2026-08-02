using FluentAssertions;
using LocalContextBridge.Core.Security;
using Xunit;

namespace LocalContextBridge.Core.Tests;

public sealed class SecretRedactionServiceTests
{
    private readonly SecretRedactionService _service = new();

    [Theory]
    [InlineData("api_key=abcdEFGH12345678", "abcdEFGH12345678")]
    [InlineData("API_KEY: \"sk-abcd1234efgh5678\"", "sk-abcd1234efgh5678")]
    [InlineData("password=SuperSecretValue123", "SuperSecretValue123")]
    [InlineData("token = 'ghp_1234567890abcdefABCDEF1234567890'", "ghp_1234567890abcdefABCDEF1234567890")]
    public void Redacts_key_value_style_secrets(string input, string secretValue)
    {
        var result = _service.Redact(input);

        result.Should().NotContain(secretValue);
        result.Should().Contain("REDACTED");
    }

    [Fact]
    public void Redacts_bearer_tokens()
    {
        var result = _service.Redact("Authorization: Bearer abc123.def456-ghi789_JKL");

        result.Should().NotContain("abc123.def456-ghi789_JKL");
        result.Should().Contain("Bearer");
        result.Should().Contain("REDACTED");
    }

    [Fact]
    public void Redacts_private_key_blocks()
    {
        var pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----";
        var result = _service.Redact(pem);

        result.Should().NotContain("MIIBOgIBAAJBAK");
        result.Should().Contain("REDACTED");
    }

    [Fact]
    public void Redacts_connection_string_credentials()
    {
        var result = _service.Redact("postgres://dbuser:sup3rSecret@db.internal:5432/app");

        result.Should().NotContain("sup3rSecret");
    }

    [Fact]
    public void Redacts_azure_style_account_keys()
    {
        var result = _service.Redact("DefaultEndpointsProtocol=https;AccountName=x;AccountKey=abcdefghijklmnop1234==;EndpointSuffix=core.windows.net");

        result.Should().NotContain("abcdefghijklmnop1234==");
    }

    [Fact]
    public void Leaves_ordinary_source_code_untouched()
    {
        const string code = "public int Add(int a, int b) => a + b;";

        _service.Redact(code).Should().Be(code);
    }

    [Fact]
    public void Handles_null_or_empty_input_gracefully()
    {
        _service.Redact(string.Empty).Should().Be(string.Empty);
    }
}

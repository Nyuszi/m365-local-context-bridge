using System.Text;
using FluentAssertions;
using LocalContextBridge.Core.Security;
using Xunit;

namespace LocalContextBridge.Core.Tests;

public sealed class BinaryDetectionServiceTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("lcb-binary-tests-").FullName;
    private readonly BinaryDetectionService _service = new();

    public void Dispose()
    {
        try
        {
            Directory.Delete(_tempDir, recursive: true);
        }
        catch
        {
            // Best-effort cleanup only.
        }
    }

    [Fact]
    public void Detects_plain_text_as_non_binary()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("using System;\n\nConsole.WriteLine(\"hi\");\n"));

        _service.IsBinary(stream).Should().BeFalse();
    }

    [Fact]
    public void Detects_content_with_null_bytes_as_binary()
    {
        var bytes = new byte[] { 0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00 };
        using var stream = new MemoryStream(bytes);

        _service.IsBinary(stream).Should().BeTrue();
    }

    [Fact]
    public async Task IsBinaryFileAsync_reflects_file_contents()
    {
        var textPath = Path.Combine(_tempDir, "text.txt");
        await File.WriteAllTextAsync(textPath, "hello world\nsecond line\n");
        (await _service.IsBinaryFileAsync(textPath)).Should().BeFalse();

        var binaryPath = Path.Combine(_tempDir, "data.bin");
        await File.WriteAllBytesAsync(binaryPath, [0x00, 0x01, 0x02, 0xFF, 0x00, 0xDE, 0xAD, 0xBE, 0xEF]);
        (await _service.IsBinaryFileAsync(binaryPath)).Should().BeTrue();
    }
}

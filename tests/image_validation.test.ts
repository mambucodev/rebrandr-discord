import { describe, it, expect } from "bun:test";
import { validateImageBuffer } from "../src/utils/imageUtils";

describe("Image Validation & Processing", () => {
  it("validates PNG image buffers correctly", () => {
    // Valid PNG signature: 89 50 4E 47 0D 0A 1A 0A followed by IHDR chunk
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);
    const result = validateImageBuffer(pngHeader);
    expect(result.valid).toBe(true);
    expect(result.ext).toBe("png");
    expect(result.mimeType).toBe("image/png");
  });

  it("validates JPEG image buffers correctly", () => {
    // Valid JPEG signature: FF D8 FF
    const jpegHeader = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    const result = validateImageBuffer(jpegHeader);
    expect(result.valid).toBe(true);
    expect(result.ext).toBe("jpg");
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("validates GIF image buffers correctly", () => {
    // GIF89a signature
    const gifHeader = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "binary");
    const result = validateImageBuffer(gifHeader);
    expect(result.valid).toBe(true);
    expect(result.ext).toBe("gif");
    expect(result.mimeType).toBe("image/gif");
  });

  it("validates WEBP image buffers correctly", () => {
    // WEBP signature: RIFF....WEBP
    const webpHeader = Buffer.from("RIFF\x20\x00\x00\x00WEBPVP8 ", "binary");
    const result = validateImageBuffer(webpHeader);
    expect(result.valid).toBe(true);
    expect(result.ext).toBe("webp");
    expect(result.mimeType).toBe("image/webp");
  });

  it("rejects non-image or corrupt buffers", () => {
    const textBuffer = Buffer.from("Hello, this is a plain text file, not an image!");
    const result = validateImageBuffer(textBuffer);
    expect(result.valid).toBe(false);
    expect(result.ext).toBeNull();
    expect(result.error).toContain("Unrecognized");
  });

  it("rejects empty buffers or files over 10MB", () => {
    const empty = Buffer.alloc(0);
    expect(validateImageBuffer(empty).valid).toBe(false);

    const oversized = Buffer.alloc(11 * 1024 * 1024);
    const result = validateImageBuffer(oversized);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too large");
  });
});

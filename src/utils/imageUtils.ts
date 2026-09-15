/**
 * Utilities for validating and inspecting image file buffers (PNG, JPG, WEBP, GIF).
 */

export interface ImageValidationResult {
  valid: boolean;
  ext: string | null;
  mimeType: string | null;
  error?: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB Discord limit

export function validateImageBuffer(buffer: Buffer): ImageValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, ext: null, mimeType: null, error: "Image file is empty (0 bytes)." };
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      ext: null,
      mimeType: null,
      error: `Image is too large (${sizeMb} MB). Maximum size allowed is 10 MB.`,
    };
  }

  if (buffer.length < 12) {
    return { valid: false, ext: null, mimeType: null, error: "File is too small to be a valid image." };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, ext: "png", mimeType: "image/png" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, ext: "jpg", mimeType: "image/jpeg" };
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { valid: true, ext: "gif", mimeType: "image/gif" };
  }

  // WEBP: 'RIFF' .... 'WEBP'
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { valid: true, ext: "webp", mimeType: "image/webp" };
  }

  return {
    valid: false,
    ext: null,
    mimeType: null,
    error: "Unrecognized or unsupported image format. Supported formats: PNG, JPG/JPEG, WEBP, GIF.",
  };
}

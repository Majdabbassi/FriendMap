export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export function isAllowedImageType(contentType: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType);
}

/**
 * Sniffs the declared image type straight from the file's magic bytes.
 * No client-supplied header is trusted: a GIF disguised as an HTML page
 * (or vice versa) is rejected because the bytes do not match.
 */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length >= 8) {
    const pngMagic = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (buffer.subarray(0, 8).equals(pngMagic)) return 'image/png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }

  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }

  return null;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeImage(data: string): Buffer {
  if (!BASE64_PATTERN.test(data)) {
    throw new Error('Image data must be valid base64');
  }
  return Buffer.from(data, 'base64');
}
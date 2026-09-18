import { BadRequestException } from '@nestjs/common';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentsService } from './attachments.service';
import { MAX_IMAGE_BYTES } from './image-validator';

describe('AttachmentsService', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'friendmap-uploads-'));
    process.env.UPLOADS_DIR = dir;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  const service = new AttachmentsService();

  function pngBytes(): Buffer {
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not-a-real-image-body'),
    ]);
  }

  it('creates the uploads directory on module init', async () => {
    await service.onModuleInit();
    const entries = await readdir(dir);
    expect(Array.isArray(entries)).toBe(true);
  });

  it('writes real PNG bytes and returns a public URL', async () => {
    const result = await service.saveImage(pngBytes());

    expect(result.contentType).toBe('image/png');
    expect(result.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);

    const files = await readdir(dir);
    const filename = result.url.replace('/uploads/', '');
    expect(files).toContain(filename);
  });

  it('maps JPEG, GIF, and WebP magic bytes to extensions', async () => {
    const jpeg = await service.saveImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(jpeg.contentType).toBe('image/jpeg');
    expect(jpeg.url).toMatch(/\.jpg$/);

    const gif = await service.saveImage(Buffer.from('GIF89a'));
    expect(gif.contentType).toBe('image/gif');
    expect(gif.url).toMatch(/\.gif$/);

    const webp = await service.saveImage(
      Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('WEBP'),
      ]),
    );
    expect(webp.contentType).toBe('image/webp');
    expect(webp.url).toMatch(/\.webp$/);
  });

  it('rejects HTML content masquerading as an image', async () => {
    await expect(
      service.saveImage(Buffer.from('<html><script>alert(1)</script></html>')),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects empty uploads', async () => {
    await expect(service.saveImage(Buffer.alloc(0))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects anything over the 3 MB limit', async () => {
    await expect(
      service.saveImage(Buffer.alloc(MAX_IMAGE_BYTES + 1)),
    ).rejects.toThrow(BadRequestException);
  });
});
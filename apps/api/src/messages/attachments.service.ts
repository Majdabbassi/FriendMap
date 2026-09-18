import {
  BadRequestException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MAX_IMAGE_BYTES,
  extensionForImageType,
  sniffImageType,
} from './image-validator';

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? './uploads';
}

@Injectable()
export class AttachmentsService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await mkdir(uploadsDir(), { recursive: true });
  }

  async saveImage(
    buffer: Buffer,
  ): Promise<{ url: string; contentType: string }> {
    if (buffer.byteLength === 0) {
      throw new BadRequestException('The uploaded file is empty');
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Images must be 3 MB or smaller');
    }

    const sniffed = sniffImageType(buffer);
    const extension = sniffed === null ? null : extensionForImageType(sniffed);
    if (sniffed === null || extension === null) {
      throw new BadRequestException(
        'Unsupported file type: only PNG, JPEG, GIF, and WebP images are allowed',
      );
    }

    const filename = `${randomUUID()}.${extension}`;
    await writeFile(join(uploadsDir(), filename), buffer);

    return { url: `/uploads/${filename}`, contentType: sniffed };
  }
}
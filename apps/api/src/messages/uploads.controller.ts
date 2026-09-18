import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { uploadsDir } from './attachments.service';

const FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

@Controller('uploads')
export class UploadsController {
  @Get(':filename')
  async serve(
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!FILENAME_PATTERN.test(filename)) {
      throw new NotFoundException();
    }

    const filePath = resolve(uploadsDir(), filename);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new NotFoundException();
    } catch {
      throw new NotFoundException();
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  }
}
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { uploadsDir } from './attachments.service';

const FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

type AuthedRequest = {
  user: { userId: string; email: string };
};

/**
 * Chat images are private: only the sender and the recipient of a (not deleted) message that carries the image
 * may download it. Anyone else, signed in or not, gets the same 404 as for a file that does not exist.
 */
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':filename')
  async serve(
    @Param('filename') filename: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!FILENAME_PATTERN.test(filename)) {
      throw new NotFoundException();
    }

    const userId = req.user.userId;
    const shared = await this.prisma.message.findFirst({
      where: {
        imageUrl: `/uploads/${filename}`,
        deletedAt: null,
        OR: [{ senderId: userId }, { recipientId: userId }],
      },
      select: { id: true },
    });
    if (!shared) {
      throw new NotFoundException();
    }

    const filePath = resolve(uploadsDir(), filename);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new NotFoundException();
    } catch {
      throw new NotFoundException();
    }

    // private: a shared cache or proxy must never keep someone's chat photo
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(filePath);
  }
}

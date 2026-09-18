import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AttachmentsService } from './attachments.service';
import { MAX_IMAGE_BYTES } from './image-validator';

@UseGuards(JwtAuthGuard)
@Controller('messages/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('A file field named "file" is required');
    }
    return this.attachmentsService.saveImage(file.buffer);
  }
}
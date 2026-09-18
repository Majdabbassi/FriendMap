import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ALLOWED_IMAGE_TYPES } from '../image-validator';

export class SendMessageDto {
  @IsUUID()
  recipientId: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsIn(ALLOWED_IMAGE_TYPES)
  imageContentType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_200_000)
  imageData?: string;
}
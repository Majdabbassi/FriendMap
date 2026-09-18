import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const IMAGE_URL_PATTERN =
  /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

export class SendMessageDto {
  @IsUUID()
  recipientId: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @Matches(IMAGE_URL_PATTERN)
  imageUrl?: string;
}
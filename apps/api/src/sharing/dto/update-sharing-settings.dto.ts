import { SharingMode } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateSharingSettingsDto {
  @IsEnum(SharingMode)
  mode!: SharingMode;
}
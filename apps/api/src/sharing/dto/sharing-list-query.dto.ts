import { SharingListType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class SharingListQueryDto {
  @IsEnum(SharingListType)
  type!: SharingListType;
}
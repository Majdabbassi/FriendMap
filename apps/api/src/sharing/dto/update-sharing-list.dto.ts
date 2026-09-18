import { SharingListType } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class UpdateSharingListDto {
  @IsUUID()
  friendId!: string;

  @IsEnum(SharingListType)
  listType!: SharingListType;
}
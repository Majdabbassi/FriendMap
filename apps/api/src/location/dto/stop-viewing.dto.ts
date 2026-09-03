import { IsUUID } from 'class-validator';

export class StopViewingDto {
  @IsUUID()
  friendId!: string;
}

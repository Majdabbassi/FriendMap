import { IsBoolean, IsUUID } from 'class-validator';

export class TypingDto {
  @IsUUID()
  friendId: string;

  @IsBoolean()
  typing: boolean;
}
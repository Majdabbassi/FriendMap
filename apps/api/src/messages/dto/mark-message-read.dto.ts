import { IsUUID } from 'class-validator';

export class MarkMessageReadDto {
  @IsUUID()
  senderId: string;
}
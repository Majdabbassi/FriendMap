import { IsBoolean, IsUUID } from 'class-validator';

export class TripTypingDto {
  @IsUUID()
  tripId: string;

  @IsBoolean()
  typing: boolean;
}
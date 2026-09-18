import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendTripMessageDto {
  @IsUUID()
  tripId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class InviteToTripDto {
  @IsUUID()
  friendId: string;
}

export class RespondInviteDto {
  @IsBoolean()
  accept: boolean;
}

export class SetMeetupDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class RespondProposalDto {
  @IsBoolean()
  accept: boolean;
}
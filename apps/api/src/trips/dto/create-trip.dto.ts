import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTripDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  memberIds?: string[];

  @IsOptional()
  @IsLatitude()
  meetupLat?: number;

  @IsOptional()
  @IsLongitude()
  meetupLng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  meetupName?: string;

  @IsOptional()
  @IsDateString()
  meetingTime?: string;
}
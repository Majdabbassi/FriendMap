import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username must be alphanumeric and may include underscores',
  })
  username: string;

  @IsString()
  @MinLength(8)
  password: string;
}

import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'atLeastOneTarget', async: false })
class AtLeastOneTargetConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as CreateFriendshipRequestDto;
    return Boolean(obj.targetEmail || obj.targetUsername);
  }

  defaultMessage() {
    return 'either targetEmail or targetUsername must be provided';
  }
}

export class CreateFriendshipRequestDto {
  @IsOptional()
  @IsEmail()
  @Validate(AtLeastOneTargetConstraint)
  targetEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  targetUsername?: string;
}

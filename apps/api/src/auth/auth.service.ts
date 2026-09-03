import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    try {
      const user = await this.usersService.create({
        email: dto.email,
        username: dto.username,
        passwordHash,
      });
      return this.signToken(user.id, user.email, user.username);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const target = (error as { meta?: { target?: string[] | string } })
          .meta?.target;
        const fields = Array.isArray(target) ? target : target ? [target] : [];
        if (fields.includes('username')) {
          throw new ConflictException('Username already taken');
        }
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user =
      (await this.usersService.findByEmail(dto.identifier)) ??
      (await this.usersService.findByUsername(dto.identifier));
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.signToken(user.id, user.email, user.username);
  }

  private async signToken(userId: string, email: string, username: string) {
    const access_token = await this.jwtService.signAsync({
      sub: userId,
      email,
      username,
    });
    return { access_token };
  }
}

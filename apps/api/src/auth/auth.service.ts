import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { randomUUID } from 'node:crypto';

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
    private readonly prisma: PrismaService,
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
      return this.signTokens(user.id, user.email, user.username);
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
    const user = await this.usersService.findByIdentifier(dto.identifier);
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

    return this.signTokens(user.id, user.email, user.username);
  }

  async refreshTokens(refreshToken: string) {
    const token = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (token.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: token.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    // Delete old refresh token and create new one
    await this.prisma.refreshToken.delete({ where: { id: token.id } });

    return this.signTokens(token.user.id, token.user.email, token.user.username);
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  private async signTokens(userId: string, email: string, username: string) {
    const access_token = await this.jwtService.signAsync({
      sub: userId,
      email,
      username,
    });

    const refresh_token = randomUUID();
    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        token: refresh_token,
        userId,
        expiresAt: refreshTokenExpiry,
      },
    });

    return { access_token, refresh_token };
  }
}

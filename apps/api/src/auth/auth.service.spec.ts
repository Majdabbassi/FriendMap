import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const jwtService = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const prisma = {
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: 'token-id' }),
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const usersService = {
    findByEmail: jest.fn(),
    findByIdentifier: jest.fn(),
    create: jest.fn(),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(usersService as never, jwtService as never, prisma as never);
    usersService.findByEmail.mockResolvedValue(null);
    usersService.findByIdentifier.mockResolvedValue(null);
  });

  it('reports duplicate email constraints as email conflicts', async () => {
    usersService.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['email'] },
    });

    await expect(
      service.register({
        email: 'alice@example.com',
        username: 'alice',
        password: 'password123',
      }),
    ).rejects.toThrow(new ConflictException('Email already in use'));
  });

  it('reports duplicate username constraints as username conflicts', async () => {
    usersService.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['username'] },
    });

    await expect(
      service.register({
        email: 'bob@example.com',
        username: 'alice',
        password: 'password123',
      }),
    ).rejects.toThrow(new ConflictException('Username already taken'));
  });

  it('logs in with an email identifier', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-id',
      email: 'alice@example.com',
      username: 'alice',
      passwordHash,
    });

    await expect(
      service.login({ identifier: 'alice@example.com', password: 'password123' }),
    ).resolves.toEqual({
      access_token: 'access-token',
      refresh_token: expect.any(String),
    });
    expect(usersService.findByIdentifier).toHaveBeenCalledWith('alice@example.com');
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-id' }),
    });
  });

  it('logs in with a username identifier', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-id',
      email: 'alice@example.com',
      username: 'alice',
      passwordHash,
    });

    await expect(
      service.login({ identifier: 'alice', password: 'password123' }),
    ).resolves.toEqual({
      access_token: 'access-token',
      refresh_token: expect.any(String),
    });
  });

  it('rejects a valid identifier with a wrong password', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-id',
      email: 'alice@example.com',
      username: 'alice',
      passwordHash,
    });

    await expect(
      service.login({ identifier: 'alice@example.com', password: 'wrong' }),
    ).rejects.toThrow('Invalid credentials');
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('deletes refresh tokens only for the given user on logout', async () => {
    await service.logout('user-id');

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
    });
  });
});
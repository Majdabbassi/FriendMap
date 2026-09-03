import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const jwtService = { signAsync: jest.fn().mockResolvedValue('token') };
  const usersService = {
    findByEmail: jest.fn(),
    findByUsername: jest.fn(),
    create: jest.fn(),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(usersService as never, jwtService as never);
    usersService.findByEmail.mockResolvedValue(null);
    usersService.findByUsername.mockResolvedValue(null);
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
    usersService.findByEmail.mockResolvedValue({
      id: 'user-id',
      email: 'alice@example.com',
      passwordHash,
    });

    await expect(
      service.login({ identifier: 'alice@example.com', password: 'password123' }),
    ).resolves.toEqual({ access_token: 'token' });
    expect(usersService.findByUsername).not.toHaveBeenCalled();
  });

  it('logs in with a username identifier', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByUsername.mockResolvedValue({
      id: 'user-id',
      email: 'alice@example.com',
      passwordHash,
    });

    await expect(
      service.login({ identifier: 'alice', password: 'password123' }),
    ).resolves.toEqual({ access_token: 'token' });
    expect(usersService.findByEmail).toHaveBeenCalledWith('alice');
  });

  it('rejects a valid identifier with a wrong password', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByEmail.mockResolvedValue({
      id: 'user-id',
      email: 'alice@example.com',
      passwordHash,
    });

    await expect(
      service.login({ identifier: 'alice@example.com', password: 'wrong' }),
    ).rejects.toThrow('Invalid credentials');
  });
});

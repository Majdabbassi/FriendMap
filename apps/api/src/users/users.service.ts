import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findByEmail(email: string) {
    return this.usersRepository.findByEmail(email);
  }

  findByUsername(username: string) {
    return this.usersRepository.findByUsername(username);
  }

  findByIdentifier(identifier: string) {
    return this.usersRepository.findByIdentifier(identifier);
  }

  create(data: { email: string; username: string; passwordHash: string }) {
    return this.usersRepository.create(data);
  }

  findById(id: string) {
    return this.usersRepository.findById(id);
  }

  findPublicById(id: string) {
    return this.usersRepository.findPublicById(id);
  }

  findPublicByIdentifier(identifier: string) {
    return this.usersRepository.findPublicByIdentifier(identifier);
  }

  findManyByIds(ids: string[]) {
    return this.usersRepository.findManyByIds(ids);
  }
}

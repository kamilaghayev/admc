import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type {
  CreateUserInput,
  PublicUser,
  User,
  UserRole,
} from "../domain/user.js";
import { toPublicUser } from "../domain/user.js";
import type { UserRepository } from "../repositories/types.js";

const BCRYPT_ROUNDS = 10;

export class UserAlreadyExistsError extends Error {
  constructor(username: string) {
    super(`username already exists: ${username}`);
    this.name = "UserAlreadyExistsError";
  }
}

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async createUser(input: CreateUserInput): Promise<PublicUser> {
    const existing = await this.repo.findByUsername(input.username);
    if (existing) {
      throw new UserAlreadyExistsError(input.username);
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      username: input.username,
      passwordHash,
      role: input.role ?? "user",
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.repo.insert(user);
    return toPublicUser(saved);
  }

  findByUsername(username: string): Promise<User | null> {
    return this.repo.findByUsername(username);
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findById(id);
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async ensureUser(
    username: string,
    password: string,
    role: UserRole,
  ): Promise<PublicUser> {
    const existing = await this.repo.findByUsername(username);
    if (existing) return toPublicUser(existing);
    return this.createUser({ username, password, role });
  }
}

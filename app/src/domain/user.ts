export type UserRole = "admin" | "user";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicUser = Omit<User, "passwordHash">;

export type CreateUserInput = {
  username: string;
  password: string;
  role?: UserRole;
};

export type LoginInput = {
  username: string;
  password: string;
};

export function toPublicUser(u: User): PublicUser {
  const { passwordHash: _ignore, ...rest } = u;
  return rest;
}

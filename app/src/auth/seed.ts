import type { UserService } from "../services/user.service.js";

export type SeedAdminInput = {
  username: string;
  password: string;
};

export async function seedAdmin(
  users: UserService,
  input: SeedAdminInput,
): Promise<void> {
  const existing = await users.findByUsername(input.username);
  if (existing) {
    console.log(`[seed] admin user exists: ${input.username}`);
    return;
  }
  await users.createUser({
    username: input.username,
    password: input.password,
    role: "admin",
  });
  console.log(`[seed] admin user created: ${input.username}`);
}

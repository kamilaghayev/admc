import type {
  CreatePostInput,
  Post,
  UpdatePostInput,
} from "../domain/post.js";
import type { User } from "../domain/user.js";

export type ReadStrategy = "race" | "postgres" | "mongo" | "decision";

export type ListQuery = {
  limit?: number;
  offset?: number;
};

export interface PostRepository {
  create(input: CreatePostInput): Promise<Post>;
  findById(id: string): Promise<Post | null>;
  findAll(query?: ListQuery): Promise<Post[]>;
  update(id: string, input: UpdatePostInput): Promise<Post | null>;
  delete(id: string): Promise<boolean>;
}

export type BaseUpdate = UpdatePostInput & { updatedAt: Date };

export interface BasePostRepository {
  init(): Promise<void>;
  insert(post: Post): Promise<Post>;
  findById(id: string): Promise<Post | null>;
  findAll(query?: ListQuery): Promise<Post[]>;
  update(id: string, input: BaseUpdate): Promise<Post | null>;
  delete(id: string): Promise<boolean>;
}

export interface UserRepository {
  insert(user: User): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findAll(query?: ListQuery): Promise<User[]>;
}

export interface BaseUserRepository extends UserRepository {
  init(): Promise<void>;
}

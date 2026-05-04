import type { Collection, Db } from "mongodb";
import type { User, UserRole } from "../../domain/user.js";
import type { BaseUserRepository, ListQuery } from "../types.js";

type UserDoc = {
  _id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
};

function docToUser(doc: UserDoc): User {
  return {
    id: doc._id,
    username: doc.username,
    passwordHash: doc.passwordHash,
    role: doc.role,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export class MongoUserRepository implements BaseUserRepository {
  private readonly collection: Collection<UserDoc>;

  constructor(db: Db) {
    this.collection = db.collection<UserDoc>("users");
  }

  async init(): Promise<void> {
    await this.collection.createIndex({ username: 1 }, { unique: true });
    await this.collection.createIndex({ createdAt: -1 });
  }

  async insert(user: User): Promise<User> {
    const doc: UserDoc = {
      _id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    await this.collection.insertOne(doc);
    return user;
  }

  async findById(id: string): Promise<User | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? docToUser(doc) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const doc = await this.collection.findOne({ username });
    return doc ? docToUser(doc) : null;
  }

  async findAll(query: ListQuery = {}): Promise<User[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const docs = await this.collection
      .find({})
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(docToUser);
  }
}

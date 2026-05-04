import type { Collection, Db } from "mongodb";
import type { Post } from "../../domain/post.js";
import type {
  BasePostRepository,
  BaseUpdate,
  ListQuery,
} from "../types.js";

type PostDoc = {
  _id: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

function docToPost(doc: PostDoc): Post {
  return {
    id: doc._id,
    title: doc.title,
    content: doc.content,
    author: doc.author,
    tags: doc.tags ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export class MongoPostRepository implements BasePostRepository {
  private readonly collection: Collection<PostDoc>;

  constructor(db: Db) {
    this.collection = db.collection<PostDoc>("posts");
  }

  async init(): Promise<void> {
    await this.collection.createIndex({ createdAt: -1 });
  }

  async insert(post: Post): Promise<Post> {
    const doc: PostDoc = {
      _id: post.id,
      title: post.title,
      content: post.content,
      author: post.author,
      tags: post.tags,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
    await this.collection.insertOne(doc);
    return post;
  }

  async findById(id: string): Promise<Post | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? docToPost(doc) : null;
  }

  async findAll(query: ListQuery = {}): Promise<Post[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const docs = await this.collection
      .find({})
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(docToPost);
  }

  async update(id: string, input: BaseUpdate): Promise<Post | null> {
    const set: Partial<PostDoc> = { updatedAt: input.updatedAt };
    if (input.title !== undefined) set.title = input.title;
    if (input.content !== undefined) set.content = input.content;
    if (input.author !== undefined) set.author = input.author;
    if (input.tags !== undefined) set.tags = input.tags;

    const doc = await this.collection.findOneAndUpdate(
      { _id: id },
      { $set: set },
      { returnDocument: "after" },
    );
    return doc ? docToPost(doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.collection.deleteOne({ _id: id });
    return r.deletedCount > 0;
  }
}

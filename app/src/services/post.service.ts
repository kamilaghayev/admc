import type {
  CreatePostInput,
  Post,
  UpdatePostInput,
} from "../domain/post.js";
import type { ListQuery, PostRepository } from "../repositories/types.js";

export class PostService {
  constructor(private readonly repo: PostRepository) {}

  createPost(input: CreatePostInput): Promise<Post> {
    return this.repo.create(input);
  }

  getPost(id: string): Promise<Post | null> {
    return this.repo.findById(id);
  }

  listPosts(query?: ListQuery): Promise<Post[]> {
    return this.repo.findAll(query);
  }

  updatePost(id: string, input: UpdatePostInput): Promise<Post | null> {
    return this.repo.update(id, input);
  }

  deletePost(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }
}

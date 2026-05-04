export type Post = {
  id: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type CreatePostInput = {
  title: string;
  content: string;
  author: string;
  tags?: string[];
};

export type UpdatePostInput = {
  title?: string;
  content?: string;
  author?: string;
  tags?: string[];
};

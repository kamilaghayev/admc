import { Router, type Request, type Response } from "express";
import type { CreatePostInput, UpdatePostInput } from "../domain/post.js";
import type { PostService } from "../services/post.service.js";

function parseCreate(body: unknown): CreatePostInput | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be an object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.title !== "string" || b.title.trim() === "") {
    return { error: "title is required" };
  }
  if (typeof b.content !== "string" || b.content.trim() === "") {
    return { error: "content is required" };
  }
  if (typeof b.author !== "string" || b.author.trim() === "") {
    return { error: "author is required" };
  }
  let tags: string[] | undefined;
  if (b.tags !== undefined) {
    if (
      !Array.isArray(b.tags) ||
      !b.tags.every((t) => typeof t === "string")
    ) {
      return { error: "tags must be string[]" };
    }
    tags = b.tags as string[];
  }
  return {
    title: b.title,
    content: b.content,
    author: b.author,
    tags,
  };
}

function parseUpdate(body: unknown): UpdatePostInput | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be an object" };
  }
  const b = body as Record<string, unknown>;
  const out: UpdatePostInput = {};
  if (b.title !== undefined) {
    if (typeof b.title !== "string") return { error: "title must be string" };
    out.title = b.title;
  }
  if (b.content !== undefined) {
    if (typeof b.content !== "string") return { error: "content must be string" };
    out.content = b.content;
  }
  if (b.author !== undefined) {
    if (typeof b.author !== "string") return { error: "author must be string" };
    out.author = b.author;
  }
  if (b.tags !== undefined) {
    if (
      !Array.isArray(b.tags) ||
      !b.tags.every((t) => typeof t === "string")
    ) {
      return { error: "tags must be string[]" };
    }
    out.tags = b.tags as string[];
  }
  if (Object.keys(out).length === 0) {
    return { error: "no updatable fields provided" };
  }
  return out;
}

export function buildPostsRouter(service: PostService): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const parsed = parseCreate(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const post = await service.createPost(parsed);
    res.status(201).json(post);
  });

  router.get("/", async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const posts = await service.listPosts({ limit, offset });
    res.json(posts);
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const post = await service.getPost(req.params.id!);
    if (!post) {
      res.status(404).json({ error: "post not found" });
      return;
    }
    res.json(post);
  });

  router.patch("/:id", async (req: Request, res: Response) => {
    const parsed = parseUpdate(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const post = await service.updatePost(req.params.id!, parsed);
    if (!post) {
      res.status(404).json({ error: "post not found" });
      return;
    }
    res.json(post);
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const ok = await service.deletePost(req.params.id!);
    if (!ok) {
      res.status(404).json({ error: "post not found" });
      return;
    }
    res.status(204).end();
  });

  return router;
}

export const openApiTags = [
  { name: "Posts", description: "Posts CRUD (primary+mirror write, race-read)" },
];

export const openApiSchemas = {
  Post: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      content: { type: "string" },
      author: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  CreatePostInput: {
    type: "object",
    required: ["title", "content", "author"],
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      author: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  UpdatePostInput: {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      author: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
};

export const openApiPaths = {
  "/api/posts": {
    get: {
      tags: ["Posts"],
      summary: "List posts (read strategy)",
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
      ],
      responses: {
        "200": {
          description: "Posts",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/Post" },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ["Posts"],
      summary: "Create post (decision primary + background mirror)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreatePostInput" },
          },
        },
      },
      responses: {
        "201": {
          description: "Created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Post" },
            },
          },
        },
        "400": { description: "Validation error" },
      },
    },
  },
  "/api/posts/{id}": {
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    get: {
      tags: ["Posts"],
      summary: "Get post by id (read strategy)",
      responses: {
        "200": {
          description: "Post",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Post" },
            },
          },
        },
        "404": { description: "Not found" },
      },
    },
    patch: {
      tags: ["Posts"],
      summary: "Update post (decision primary + background mirror)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UpdatePostInput" },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Post" },
            },
          },
        },
        "404": { description: "Not found" },
      },
    },
    delete: {
      tags: ["Posts"],
      summary: "Delete post (decision primary + background mirror)",
      responses: {
        "204": { description: "Deleted" },
        "404": { description: "Not found" },
      },
    },
  },
};

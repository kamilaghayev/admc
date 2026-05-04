import { Router, type Request, type Response } from "express";

export type RootDeps = {
  publicUrl: string;
};

export function buildRootRouter(deps: RootDeps): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({
      message: "Hello from Diss API",
      docs: `${deps.publicUrl}/api-docs`,
    });
  });

  return router;
}

export const openApiTags = [
  { name: "Root", description: "Root meta endpoint" },
];

export const openApiPaths = {
  "/": {
    get: {
      tags: ["Root"],
      summary: "Root",
      responses: {
        "200": {
          description: "Salamlama",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  docs: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};

import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type {
  HttpMetricRecord,
  MetricRecord,
} from "../metrics/repository-metrics.js";

export type MetricsSocket = {
  io: Server;
  publishRepo: (r: MetricRecord) => void;
  publishHttp: (h: HttpMetricRecord) => void;
};

export function attachMetricsSocket(
  httpServer: HttpServer,
  corsOrigins: string[],
): MetricsSocket {
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: corsOrigins.length ? corsOrigins : true,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", () => {});

  return {
    io,
    publishRepo: (r: MetricRecord) => {
      io.emit("repo:metric", r);
    },
    publishHttp: (h: HttpMetricRecord) => {
      io.emit("http:metric", h);
    },
  };
}

import { HttpMiddleware, HttpRouter } from "effect/unstable/http";

export const CorsMiddleware = HttpRouter.middleware(
  HttpMiddleware.cors({
    allowedOrigins: [],
    allowedMethods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Requested-With"],
    credentials: true,
    maxAge: 86400,
  }),
  { global: true },
);

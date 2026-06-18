import { HttpMiddleware, HttpRouter } from "effect/unstable/http";

export const CorsMiddleware = HttpRouter.middleware(
  HttpMiddleware.cors({
    allowedOrigins: [],
    allowedMethods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Forge-User-Id",
      "X-Forge-User-Email",
      "X-Forge-User-Name",
      "X-Forge-User-Team",
    ],
    credentials: true,
    maxAge: 86400,
  }),
  { global: true },
);

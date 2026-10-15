/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import bcrypt from "bcryptjs";

export const authPlugin = fp(async (app: FastifyInstance) => {
  const fastifyJwt = (await import("@fastify/jwt")).default;
  await app.register(fastifyJwt as any, {
    secret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
    sign: { expiresIn: "7d" },
  });

  app.addHook("onRequest", async (req) => {
    if (req.raw.url?.startsWith("/api/auth/") || req.raw.url?.startsWith("/api/docs")) {
      (req as any).user = null;
      return;
    }
    try {
      const payload = await (req as any).jwtVerify();
      (req as any).user = payload as { id: string; email: string };
    } catch {
      (req as any).user = null;
    }
  });
});

export function requireAuth(req: FastifyRequest) {
  const user = (req as any).user;
  if (!user) {
    const err: any = new Error("Não autenticado");
    err.statusCode = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }
  return user as { id: string; email: string };
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signToken(app: FastifyInstance, payload: { id: string; email: string }) {
  return (app as any).jwt.sign(payload);
}

export type AuthUser = { id: string; email: string };

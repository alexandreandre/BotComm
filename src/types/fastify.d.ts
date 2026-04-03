import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Utilisateur Supabase Auth (JWT vérifié) */
    supabaseUser?: { id: string; email?: string };
  }
}

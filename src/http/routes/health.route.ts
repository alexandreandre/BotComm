export async function registerHealthRoute(app: any): Promise<void> {
  app.get("/healthz", async () => {
    return { ok: true, status: "healthy" };
  });
}

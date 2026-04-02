import { DispatchController } from "../controllers/dispatch.controller";

export async function registerDispatchRoute(
  app: any,
  controller: DispatchController
): Promise<void> {
  app.post("/dispatch", controller.handle);
}

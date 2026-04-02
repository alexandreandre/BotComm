import { dispatchPayloadSchema } from "../../domain/schemas";
import { DispatchRunService } from "../../services/dispatch-run.service";

export class DispatchController {
  constructor(private readonly dispatchRunService: DispatchRunService) {}

  handle = async (request: any, reply: any): Promise<void> => {
    const payload = dispatchPayloadSchema.parse(request.body);

    request.log.info(
      {
        run_id: payload.run_id,
        game: payload.game,
        game_url: payload.game_url,
        webhook_url: payload.webhook_url
      },
      "Dispatch request received"
    );

    const response = this.dispatchRunService.dispatch(payload);
    reply.status(202).send(response);
  };
}

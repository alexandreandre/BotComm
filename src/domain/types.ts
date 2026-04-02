export type RunStatus = "completed" | "failed";

export interface DispatchPayload {
  run_id: string;
  callback_token: string;
  webhook_url: string;
  game_url: string;
  game: string;
  bot_goal: string;
  max_duration_seconds: number;
  storage_bucket: string;
  storage_path: string;
}

export interface RunEvent {
  event_type: "start" | "gameplay" | "end" | "error";
  description: string;
  data?: Record<string, unknown>;
}

export interface CompletedCallbackPayload {
  run_id: string;
  callback_token: string;
  status: "completed";
  score: number;
  streak: number;
  duration: number;
  video_path: string;
  screenshots: string[];
  events: RunEvent[];
  error_message: null;
}

export interface FailedCallbackPayload {
  run_id: string;
  callback_token: string;
  status: "failed";
  error_message: string;
}

export type CallbackPayload = CompletedCallbackPayload | FailedCallbackPayload;

export interface DispatchAcceptedResponse {
  ok: true;
  run_id: string;
  status: "accepted";
}

export interface UploadResult {
  video_path: string;
  screenshots: string[];
}

export interface GameRunResult {
  score: number | null;
  streak: number | null;
  events: RunEvent[];
  screenshotPaths: string[];
}

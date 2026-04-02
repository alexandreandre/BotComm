import { Page } from "playwright";
import { GameRunResult } from "../../domain/types";

export interface AdapterRunContext {
  runId: string;
  maxDurationMs: number;
  botGoal: string;
}

export interface GameAdapter {
  readonly name: string;
  init(page: Page): Promise<void>;
  start(): Promise<void>;
  play(context: AdapterRunContext): Promise<GameRunResult>;
  extractScore(): Promise<number | null>;
  extractStreak(): Promise<number | null>;
  isGameOver(): Promise<boolean>;
}

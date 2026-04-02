import { GameAdapter } from "./base/game-adapter";
import { MovieQuizAdapter } from "./movie-quiz/adapter";

function normalizeGameName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export class GameAdapterRegistry {
  private readonly factories: Map<string, () => GameAdapter>;

  constructor() {
    this.factories = new Map<string, () => GameAdapter>([
      ["movie-quiz", () => new MovieQuizAdapter()],
      ["moviequiz", () => new MovieQuizAdapter()]
    ]);
  }

  resolve(gameName: string): GameAdapter {
    const normalized = normalizeGameName(gameName);
    const create = this.factories.get(normalized) ?? (() => new MovieQuizAdapter());
    return create();
  }
}

import { Page } from "playwright";
import { GameAdapter, AdapterRunContext } from "../base/game-adapter";
import { GameRunResult, RunEvent } from "../../domain/types";
import { movieQuizSelectors } from "./selectors";
import { parseFirstInteger } from "./parser";
import { MovieQuizStrategy } from "./strategy";

export class MovieQuizAdapter implements GameAdapter {
  public readonly name = "movie-quiz";

  private page: Page | null = null;
  private readonly strategy = new MovieQuizStrategy();

  async init(page: Page): Promise<void> {
    this.page = page;
    await page.waitForLoadState("domcontentloaded");
    for (const selector of movieQuizSelectors.cookieAcceptButtons) {
      const button = page.locator(selector).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 1000 }).catch(() => undefined);
      }
    }
  }

  async start(): Promise<void> {
    const page = this.requirePage();
    for (const selector of movieQuizSelectors.startButtons) {
      const startButton = page.locator(selector).first();
      if (await startButton.isVisible().catch(() => false)) {
        await startButton.click({ timeout: 1500 });
        return;
      }
    }
  }

  async play(context: AdapterRunContext): Promise<GameRunResult> {
    const page = this.requirePage();
    const events: RunEvent[] = [
      {
        event_type: "start",
        description: "Debut de la partie",
        data: { game: this.name, bot_goal: context.botGoal }
      }
    ];

    const screenshotPaths: string[] = [];
    const startedAt = Date.now();

    while (Date.now() - startedAt < context.maxDurationMs) {
      if (await this.isGameOver()) {
        events.push({
          event_type: "end",
          description: "Partie terminee (game over detecte)"
        });
        break;
      }

      const answered = await this.strategy.pickAndAnswer(page, movieQuizSelectors.answerButtons);
      if (answered) {
        events.push({
          event_type: "gameplay",
          description: "Reponse envoyee",
          data: { timestamp: Date.now() }
        });
      }

      await page.waitForTimeout(1200);
    }

    const score = await this.extractScore();
    const streak = await this.extractStreak();

    if (score !== null) {
      events.push({
        event_type: "end",
        description: "Score final extrait",
        data: { score }
      });
    }

    return {
      score,
      streak,
      events,
      screenshotPaths
    };
  }

  async extractScore(): Promise<number | null> {
    const page = this.requirePage();
    for (const selector of movieQuizSelectors.scoreText) {
      const raw = await page.locator(selector).first().textContent().catch(() => null);
      const parsed = parseFirstInteger(raw);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  async extractStreak(): Promise<number | null> {
    const page = this.requirePage();
    for (const selector of movieQuizSelectors.streakText) {
      const raw = await page.locator(selector).first().textContent().catch(() => null);
      const parsed = parseFirstInteger(raw);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  async isGameOver(): Promise<boolean> {
    const page = this.requirePage();
    for (const marker of movieQuizSelectors.gameOverMarkers) {
      const isVisible = await page.locator(marker).first().isVisible().catch(() => false);
      if (isVisible) {
        return true;
      }
    }
    return false;
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error("MovieQuizAdapter is not initialized");
    }
    return this.page;
  }
}

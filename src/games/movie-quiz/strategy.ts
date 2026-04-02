import { Page } from "playwright";

export class MovieQuizStrategy {
  async pickAndAnswer(page: Page, selectors: string[]): Promise<boolean> {
    for (const selector of selectors) {
      const buttons = page.locator(selector);
      const count = await buttons.count();
      if (count < 1) {
        continue;
      }
      const randomIndex = Math.floor(Math.random() * count);
      await buttons.nth(randomIndex).click({ timeout: 1000 });
      return true;
    }
    return false;
  }
}

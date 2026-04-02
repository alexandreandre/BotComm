import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Page } from "playwright";

export class ScreenshotService {
  async capture(page: Page, outputDir: string, fileName: string): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    const fullPath = path.join(outputDir, fileName);
    await page.screenshot({ path: fullPath, fullPage: true });
    return fullPath;
  }
}

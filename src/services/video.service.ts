import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { Page } from "playwright";
import { AppError } from "../core/errors";

export class VideoService {
  async resolveVideoPath(page: Page): Promise<string> {
    const video = page.video();
    if (!video) {
      throw new AppError("Video recording is not available for this page", {
        code: "VIDEO_UNAVAILABLE"
      });
    }

    const videoPath = await video.path();
    await access(videoPath, constants.R_OK).catch(() => {
      throw new AppError("Recorded video file is missing", { code: "VIDEO_MISSING" });
    });
    return videoPath;
  }
}

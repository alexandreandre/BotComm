import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { AppError } from "../core/errors";
import { UploadResult } from "../domain/types";

export class StorageService {
  private readonly supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  async uploadRunArtifacts(input: {
    bucket: string;
    storagePath: string;
    videoLocalPath: string;
    screenshotLocalPaths: string[];
  }): Promise<UploadResult> {
    const bucket = input.bucket || env.DEFAULT_STORAGE_BUCKET;
    const videoStoragePath = this.joinStoragePath(input.storagePath, "raw.webm");
    const videoBuffer = await readFile(input.videoLocalPath);

    const videoUpload = await this.supabase.storage.from(bucket).upload(videoStoragePath, videoBuffer, {
      contentType: "video/webm",
      upsert: true
    });

    if (videoUpload.error) {
      throw new AppError(`Failed to upload video to Supabase: ${videoUpload.error.message}`, {
        code: "STORAGE_UPLOAD_FAILED",
        retriable: true
      });
    }

    const screenshotPaths: string[] = [];
    for (const screenshotLocalPath of input.screenshotLocalPaths) {
      const fileName = path.basename(screenshotLocalPath);
      const storageTargetPath = this.joinStoragePath(input.storagePath, fileName);
      const screenshotBuffer = await readFile(screenshotLocalPath);
      const result = await this.supabase.storage.from(bucket).upload(storageTargetPath, screenshotBuffer, {
        contentType: "image/png",
        upsert: true
      });

      if (result.error) {
        throw new AppError(`Failed to upload screenshot to Supabase: ${result.error.message}`, {
          code: "SCREENSHOT_UPLOAD_FAILED",
          retriable: true
        });
      }
      screenshotPaths.push(storageTargetPath);
    }

    return {
      video_path: videoStoragePath,
      screenshots: screenshotPaths
    };
  }

  private joinStoragePath(base: string, file: string): string {
    return `${base.replace(/\/+$/, "")}/${file}`.replace(/^\/+/, "");
  }
}

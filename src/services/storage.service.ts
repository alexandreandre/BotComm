import { readFile } from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { AppError } from "../core/errors";
import { UploadResult } from "../domain/types";

export class StorageService {
  private readonly supabase: SupabaseClient | null;
  private readonly gcs: Storage | null;

  constructor() {
    if (env.STORAGE_BACKEND === "supabase") {
      this.supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      this.gcs = null;
    } else {
      this.supabase = null;
      this.gcs = new Storage();
    }
  }

  async uploadRunArtifacts(input: {
    bucket: string;
    storagePath: string;
    videoLocalPath: string;
    screenshotLocalPaths: string[];
  }): Promise<UploadResult> {
    const bucketName = input.bucket || env.DEFAULT_STORAGE_BUCKET;
    const videoStoragePath = this.joinStoragePath(input.storagePath, "raw.webm");
    const videoBuffer = await readFile(input.videoLocalPath);

    if (env.STORAGE_BACKEND === "supabase") {
      return this.uploadSupabase(bucketName, videoStoragePath, videoBuffer, input);
    }
    return this.uploadGcs(bucketName, videoStoragePath, videoBuffer, input);
  }

  /** URL publique ou de lecture pour un objet déjà uploadé (GCS uniforme). */
  publicUrlForPath(bucket: string, objectPath: string): string {
    const b = bucket || env.GCS_BUCKET || env.DEFAULT_STORAGE_BUCKET;
    if (env.STORAGE_BACKEND === "gcs") {
      return `https://storage.googleapis.com/${b}/${objectPath.replace(/^\/+/, "")}`;
    }
    const base = env.SUPABASE_URL!.replace(/\/+$/, "");
    return `${base}/storage/v1/object/public/${b}/${objectPath.replace(/^\/+/, "")}`;
  }

  private async uploadSupabase(
    bucket: string,
    videoStoragePath: string,
    videoBuffer: Buffer,
    input: {
      storagePath: string;
      screenshotLocalPaths: string[];
    }
  ): Promise<UploadResult> {
    const videoUpload = await this.supabase!.storage.from(bucket).upload(videoStoragePath, videoBuffer, {
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
      const result = await this.supabase!.storage.from(bucket).upload(storageTargetPath, screenshotBuffer, {
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

  private async uploadGcs(
    bucket: string,
    videoStoragePath: string,
    videoBuffer: Buffer,
    input: {
      storagePath: string;
      screenshotLocalPaths: string[];
    }
  ): Promise<UploadResult> {
    const gcsBucket = this.gcs!.bucket(bucket);

    await gcsBucket.file(videoStoragePath).save(videoBuffer, {
      contentType: "video/webm",
      resumable: false,
      metadata: { cacheControl: "public, max-age=3600" }
    });

    const screenshotPaths: string[] = [];
    for (const screenshotLocalPath of input.screenshotLocalPaths) {
      const fileName = path.basename(screenshotLocalPath);
      const storageTargetPath = this.joinStoragePath(input.storagePath, fileName);
      const screenshotBuffer = await readFile(screenshotLocalPath);
      await gcsBucket.file(storageTargetPath).save(screenshotBuffer, {
        contentType: "image/png",
        resumable: false
      });
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

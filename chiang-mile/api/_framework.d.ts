/*
 * This file is a part of the Speed framework, DO NOT modify it.
 */

import 'hono'
import type { LanguageModel } from 'ai'
import type { Context } from 'hono'

declare module 'hono' {
  interface ContextVariableMap {
    // The following variables will be automatically injected by the framework
    userId?: string
    userRole?: 'owner' | 'contributor' | 'readonly' | 'app-user'
    userToken?: string
  }
}

declare module 'speed-framework' {
  /**
   * Model presets for server-side use.
   * - `'thinking'` — reasoning model (slower, smarter)
   * - `'flash'`    — fast non-reasoning model
   */
  export type SpeedLLMModel = 'thinking' | 'flash'

  /**
   * Returns a Speed-backed chat model handle for `streamText` / `generateText` / `streamObject` / `generateObject` from `ai`.
   *
   * - `getSpeedLLMModel('flash')` — bills the app developer (automatically uses `SPEED_APP_KEY` from env)
   * - `getSpeedLLMModel('flash', { userToken: ctx.var.userToken })` — bills the end user
   */
  export function getSpeedLLMModel(model: SpeedLLMModel, options?: { userToken?: string }): LanguageModel

  /**
   * Options for {@link speedImage.generate}.
   */
  export interface SpeedImageGenerateOptions {
    /** Prompt describing the image to generate. */
    prompt: string
    /** Target `width:height` (e.g. "16:9", "4:5"). Mismatched output is centre-cropped. */
    forceRatio?: string
    /** Speed user JWT — when provided, the end user is billed. */
    userToken?: string
  }

  /**
   * Options for {@link speedImage.transform}.
   */
  export interface SpeedImageTransformOptions extends SpeedImageGenerateOptions {
    /** Source image URL or base64-encoded data URI. */
    image: string
  }

  /**
   * Result returned by `speedImage`. `url` is a convenience alias for `data[0].url`.
   */
  export interface SpeedImageResult {
    url: string
    data: { url: string }[]
  }

  /**
   * Server-side image API, mirroring `speed.image` on the frontend.
   *
   * - `speedImage.generate({ prompt })` — text-to-image, billed to the app developer (automatically uses `SPEED_APP_KEY` from env).
   * - `speedImage.transform({ prompt, image })` — image-to-image edits.
   * - Pass `userToken: ctx.var.userToken` to bill the end user instead.
   */
  export const speedImage: {
    generate(options: SpeedImageGenerateOptions): Promise<SpeedImageResult>
    transform(options: SpeedImageTransformOptions): Promise<SpeedImageResult>
  }

  /**
   * Send a custom conversion event from the app backend.
   * Reuse the same `occurrenceId` when retrying one event occurrence.
   */
  export const analytics: {
    sendCustomEvent(context: Context, key: string, occurrenceId: string): Promise<void>
  }

  /**
   * Options for {@link speedUpload.uploadFile}.
   */
  export interface SpeedUploadOptions {
    /** Defaults to the File's name, or "file". */
    fileName?: string
    /** Defaults to the Blob's type, "text/plain" for strings, or "application/octet-stream". */
    contentType?: string
    /** Speed user JWT — when provided, the end user is billed. */
    userToken?: string
  }

  /**
   * Server-side Speed Upload, mirroring `speed.upload` on the frontend.
   *
   * - `speedUpload.uploadFile(body)` — uploads and resolves to the file's public URL, billed to the app developer (automatically uses `SPEED_APP_KEY` from env).
   * - Pass `userToken: ctx.var.userToken` to bill the end user instead.
   * - `speedUpload.deleteFile(url)` — deletes a file uploaded through this app, by its URL.
   */
  export const speedUpload: {
    uploadFile(body: Buffer | string | Uint8Array | ArrayBuffer | Blob, options?: SpeedUploadOptions): Promise<{ url: string }>
    deleteFile(url: string): Promise<boolean>
  }

  /**
   * Disconnect the signed-in user from this app on Speed.
   *
   * @param userToken - the user's Speed token, `ctx.var.userToken`
   */
  export function unlinkSpeedAccount(userToken: string): Promise<void>

}

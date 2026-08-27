/**
 * Upload a video once, then reference it from as many evaluations as you like.
 *
 * Three calls, and `upload` makes all three so a caller does not have to know
 * that. Ask where to put the file, send it, say it has landed — then wait for
 * validation, because a video is not usable until it has been checked.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";

import { InvalidRequestError } from "../errors.js";
import type { Transport } from "../internal/transport.js";
import { pollUntil, type PollOptions } from "../internal/poll.js";
import type { RequestOptions } from "../internal/options.js";
import type { Video, VideoReservation, VideoStatus } from "../types.js";

const SETTLED: VideoStatus[] = ["ready", "failed"];

/** Kept in step with the contract's `VideoCreate.size_bytes` maximum. */
const MAX_FILE_BYTES = 52_428_800;

export interface UploadParams extends PollOptions {
  /** Path to a local MP4. */
  path: string;
  /**
   * Hash the file first so the server can skip the transfer when it already
   * holds this exact content. Default true.
   *
   * It costs one extra streamed pass over the file — cheap next to sending it,
   * and it is the difference between re-uploading a clip you already sent and
   * not. Turn it off for a file you know is new and very large.
   */
  dedupe?: boolean;
  /** Return as soon as the bytes have landed, without waiting for validation. */
  wait?: boolean;
}

export class Videos {
  constructor(
    private readonly transport: Transport,
    /** Where the returned upload path is rooted, when it is not absolute. */
    private readonly uploadBaseURL: string,
  ) {}

  async retrieve(id: string, opts: RequestOptions = {}): Promise<Video> {
    return this.transport.json<Video>({
      method: "GET",
      path: `/v1/videos/${encodeURIComponent(id)}`,
      signal: opts.signal,
    });
  }

  /** Poll until validation finishes. `failed` is a normal outcome, not a throw. */
  async waitUntilReady(id: string, opts: PollOptions = {}): Promise<Video> {
    return pollUntil<Video>(
      () => this.retrieve(id, { signal: opts.signal }),
      (v) => SETTLED.includes(v.status),
      { ...opts, describe: `video ${id}`, statusOf: (v) => v.status },
    );
  }

  /**
   * Upload a local MP4 and return the record, ready to reference.
   *
   * The bytes are STREAMED, never held in memory: a 50 MB clip costs a 64 KB
   * buffer, not 50 MB, and neither does the hash pass. That matters more than it
   * sounds — a caller uploading a directory of clips concurrently would
   * otherwise hold all of them at once.
   */
  async upload(params: UploadParams): Promise<Video> {
    const { path } = params;
    const label = basename(path);
    const { size } = await stat(path);

    // Refused here rather than by the server: the caller learns before spending
    // the upload, and learns which file it was.
    if (size > MAX_FILE_BYTES) {
      throw new InvalidRequestError({
        status: 413,
        type: "invalid_request_error",
        code: "file_too_large",
        message: `${label} is ${size} bytes; the limit is ${MAX_FILE_BYTES}.`,
      });
    }
    if (size === 0) {
      throw new InvalidRequestError({
        status: 400,
        type: "invalid_request_error",
        code: "invalid_request",
        message: `${label} is empty.`,
      });
    }

    const body: Record<string, unknown> = { content_type: "video/mp4", size_bytes: size };
    if (params.dedupe !== false) body.content_hash = await hashFile(path);

    // 1. Ask where to put it.
    const reserved = await this.transport.json<VideoReservation>({
      method: "POST",
      path: "/v1/videos",
      body,
      signal: params.signal,
    });

    // The server already held this content, so there is nothing to send and
    // nothing to wait for.
    if (reserved.skip_upload || !reserved.upload_path) {
      return this.retrieve(reserved.video_id, { signal: params.signal });
    }

    // 2. Send the bytes — to storage, NOT to the API. No Authorization header:
    //    that host never needed the key, and a key sent to a host that did not
    //    need it is a key disclosed.
    await this.transport.send({
      method: "PUT",
      absoluteURL: absolute(reserved.upload_path, this.uploadBaseURL),
      rawStream: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
      contentLength: size,
      contentType: "video/mp4",
      anonymous: true,
      signal: params.signal,
      // Re-sending tens of megabytes on a transient failure is not free, and the
      // grant behind `upload_path` expires — a retry after that point would fail
      // on the signature rather than the network. Let the caller decide.
      maxRetries: 0,
    });

    // 3. Say it has landed, which starts validation.
    const done = await this.transport.json<Video>({
      method: "POST",
      path: `/v1/videos/${encodeURIComponent(reserved.video_id)}/complete`,
      signal: params.signal,
    });

    if (params.wait === false || SETTLED.includes(done.status)) return done;
    return this.waitUntilReady(reserved.video_id, params);
  }
}

/** SHA-256 of a file, streamed. */
async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** `upload_path` may be a path or a full URL; only the former needs a root. */
function absolute(uploadPath: string, base: string): string {
  if (/^https?:\/\//i.test(uploadPath)) return uploadPath;
  return `${base.replace(/\/+$/, "")}${uploadPath.startsWith("/") ? "" : "/"}${uploadPath}`;
}

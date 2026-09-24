// Thin fetch wrapper for the SmartNav panorama-capture backend. Mirrors
// frontend/src/services/panorama.service.js but for React Native's fetch
// (which accepts { uri, name, type } file parts in FormData).

import { File, Paths } from "expo-file-system";
import { recordDiagnostic } from "./diagnostics";

export type SessionStatus = "open" | "done";

export interface SessionPhoto {
  _id: string;
  path: string;
  frameId?: string;
  sequence?: number;
  uploadedAt: string;
}

export interface SessionData {
  status: SessionStatus;
  photos: SessionPhoto[];
  expiresAt: string;
}

export interface FrameMetadata {
  frameId: string;
  sequence: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export class ApiError extends Error {
  status: number;
  /** True for errors worth retrying (network hiccup, timeout, 5xx). False for
   * terminal errors (expired/unknown session, validation failure). */
  retryable: boolean;
  /** Human-readable "HTTP 400 — message" form for on-device display. */
  detail: string;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
    this.detail = status > 0 ? `HTTP ${status} — ${message}` : `Network — ${message}`;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
/** Multipart uploads carry ~0.5-1.5 MB and may share a congested LAN/hotspot. */
const UPLOAD_TIMEOUT_MS = 60_000;

async function request<T>(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const method = init.method || "GET";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : reason;
    recordDiagnostic(`${method} ${url}`, `network failure — ${message}`);
    throw new ApiError(message, 0, true);
  } finally {
    clearTimeout(timeout);
  }

  // Read as text first: a proxy/dev-server error page is not JSON, and its
  // body is far more useful than "Unexpected token < in JSON".
  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    recordDiagnostic(`${method} ${url}`, `HTTP ${response.status}, body unreadable — ${String(error)}`);
  }

  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok || !body?.success) {
    const message =
      body?.message ||
      (text && !body ? `Non-JSON response: ${text.slice(0, 160)}` : `Request failed with status ${response.status}`);
    // 400 (validation, session closed/full) and 404 (unknown/expired session)
    // are terminal. 5xx and 503 (database reconnecting) may be transient.
    const retryable = response.status >= 500;
    recordDiagnostic(`${method} ${url}`, `HTTP ${response.status} — ${message}`);
    throw new ApiError(message, response.status, retryable);
  }

  return body.data as T;
}

export function getSession(apiBase: string, token: string): Promise<SessionData> {
  return request<SessionData>(`${apiBase}/api/panorama/sessions/${token}`, { method: "GET" });
}

export function completeSession(apiBase: string, token: string): Promise<SessionData> {
  return request<SessionData>(`${apiBase}/api/panorama/sessions/${token}/complete`, { method: "POST" });
}

/**
 * Checks that a host is actually a reachable SmartNav backend. Used before
 * accepting a manually typed server address so a typo fails at the settings
 * screen rather than silently at the first upload.
 */
export async function probeServer(apiBase: string): Promise<void> {
  const url = `${apiBase}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordDiagnostic(`GET ${url}`, `probe failed — ${reason}`);
    throw new ApiError("Could not reach that address. Check the IP, port and Wi-Fi network.", 0, true);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text().catch(() => "");
  if (!response.ok || !/SmartNav/i.test(text)) {
    recordDiagnostic(`GET ${url}`, `probe rejected — HTTP ${response.status} "${text.slice(0, 80)}"`);
    throw new ApiError("That address answered, but it is not a SmartNav backend.", response.status, false);
  }
  recordDiagnostic(`GET ${url}`, "probe ok");
}

/**
 * `new File(...)` wants a `file://` URI; a bare filesystem path is not a valid
 * location for it.
 */
function toFileUri(uri: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri;
  return `file://${uri.startsWith("/") ? "" : "/"}${uri}`;
}

/**
 * Builds the multipart file part.
 *
 * Expo SDK 57 replaces React Native's XHR-backed `fetch`/`FormData` with the
 * WinterCG implementations. Their multipart encoder (expo/src/winter/fetch/
 * convertFormData.ts) serialises only a string, a `Blob`, or an object
 * exposing `bytes()` — the legacy `{ uri, name, type }` part is rejected
 * outright with "Unsupported FormDataPart implementation", before any request
 * leaves the device. `expo-file-system`'s `File` implements the `Blob`
 * interface and provides `bytes()`, `name` and `type`, so it is the part the
 * encoder expects.
 *
 * The encoder reads `name` and `type` straight off the part for the
 * Content-Disposition filename and Content-Type header, and the backend's
 * multer `fileFilter` matches the filename extension against the declared MIME
 * type. A frame that is not already a `.jpg` is therefore copied to one in the
 * cache directory rather than uploaded under a name the server will reject.
 */
async function buildImagePart(localUri: string, frameId: string): Promise<File> {
  const file = new File(toFileUri(localUri));
  if (!file.exists) {
    throw new ApiError(`Captured frame is missing on disk (${localUri})`, 0, false);
  }
  if (/\.jpe?g$/i.test(file.name)) return file;

  const jpeg = new File(Paths.cache, `${frameId}.jpg`);
  if (jpeg.exists) jpeg.delete();
  await file.copy(jpeg);
  return jpeg;
}

/**
 * Drops non-finite numbers instead of letting JSON.stringify turn them into
 * `null`, which the backend rejects with a terminal 400. A missing sensor
 * reading should cost the frame its metadata, never the upload itself.
 */
function serializeMetadata(metadata: FrameMetadata): string {
  const payload: Record<string, string | number> = { frameId: metadata.frameId };
  if (Number.isInteger(metadata.sequence) && metadata.sequence >= 0) payload.sequence = metadata.sequence;
  for (const key of ["yaw", "pitch", "roll"] as const) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) payload[key] = Number(value.toFixed(3));
  }
  return JSON.stringify(payload);
}

export async function uploadFrame(
  apiBase: string,
  token: string,
  localUri: string,
  metadata: FrameMetadata,
): Promise<SessionData> {
  const image = await buildImagePart(localUri, metadata.frameId);
  recordDiagnostic(
    `upload ${metadata.frameId}`,
    `part name="${image.name}" type="${image.type || "(none)"}" size=${image.size}B`,
  );

  const form = new FormData();
  form.append("image", image);
  form.append("metadata", serializeMetadata(metadata));

  // Content-Type is deliberately unset: the fetch implementation generates the
  // multipart boundary and header itself, and setting it by hand produces a
  // body the server cannot parse.
  return request<SessionData>(
    `${apiBase}/api/panorama/sessions/${token}/photos`,
    { method: "POST", body: form, headers: { Accept: "application/json" } },
    UPLOAD_TIMEOUT_MS,
  );
}

import { useEffect, useRef } from "react";
import { ApiError, uploadFrame } from "../lib/api";
import { recordDiagnostic } from "../lib/diagnostics";
import { CaptureFrame, SessionConfig } from "./types";
import { FramesAction } from "./framesReducer";

// Concurrency 1: capture never waits on the network, but only one frame
// uploads at a time so slow LAN/cell links don't get saturated.
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drains `frames` with status "pending" one at a time, in sequence order.
 * Retries transient failures with bounded exponential backoff; terminal
 * failures (expired/invalid session, validation errors) are not retried
 * automatically — the frame is left "failed" with `terminal: true` for the
 * UI to surface, and the queue moves on to the next frame.
 */
export function useUploadQueue(config: SessionConfig | null, frames: CaptureFrame[], dispatch: (action: FramesAction) => void) {
  const framesRef = useRef(frames);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    if (runningRef.current) return;
    const hasPending = frames.some((f) => f.status === "pending");
    if (!hasPending) return;

    runningRef.current = true;
    (async () => {
      while (!cancelledRef.current) {
        const next = framesRef.current
          .filter((f) => f.status === "pending")
          .sort((a, b) => a.sequence - b.sequence)[0];
        if (!next) break;

        dispatch({ type: "SET_STATUS", frameId: next.frameId, status: "uploading" });

        let attempt = 0;
        let succeeded = false;
        while (attempt < MAX_ATTEMPTS && !cancelledRef.current) {
          try {
            await uploadFrame(config.apiBase, config.token, next.localUri, {
              frameId: next.frameId,
              sequence: next.sequence,
              yaw: next.yaw,
              pitch: next.pitch,
              roll: next.roll,
            });
            dispatch({ type: "SET_STATUS", frameId: next.frameId, status: "uploaded" });
            succeeded = true;
            break;
          } catch (error) {
            attempt += 1;
            dispatch({ type: "INCREMENT_ATTEMPTS", frameId: next.frameId });
            const isApiError = error instanceof ApiError;
            const retryable = isApiError ? error.retryable : true;
            // Keep the backend's own wording and status code — that is what
            // makes an on-device failure diagnosable at all.
            const message = isApiError
              ? error.detail
              : error instanceof Error
                ? error.message
                : "Upload failed";
            recordDiagnostic(
              `upload ${next.frameId}`,
              `attempt ${attempt}/${MAX_ATTEMPTS} failed — ${message}`,
            );

            if (!retryable) {
              dispatch({ type: "SET_STATUS", frameId: next.frameId, status: "failed", error: message, terminal: true });
              break;
            }
            if (attempt >= MAX_ATTEMPTS) {
              dispatch({ type: "SET_STATUS", frameId: next.frameId, status: "failed", error: message, terminal: false });
              break;
            }
            await delay(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
          }
        }
        if (cancelledRef.current) break;
        void succeeded;
      }
      runningRef.current = false;
    })();
  }, [config, frames, dispatch]);
}

export function queueSummary(frames: CaptureFrame[]) {
  const pendingOrUploading = frames.filter((f) => f.status === "pending" || f.status === "uploading").length;
  const failed = frames.filter((f) => f.status === "failed");
  const terminallyFailed = failed.filter((f) => f.terminal);
  const retryableFailed = failed.filter((f) => !f.terminal);
  return {
    drained: pendingOrUploading === 0,
    pendingOrUploading,
    failedCount: failed.length,
    terminallyFailedCount: terminallyFailed.length,
    retryableFailedCount: retryableFailed.length,
  };
}

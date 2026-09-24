import React, { createContext, useCallback, useContext, useMemo, useReducer, useState } from "react";
import { CaptureFrame, SessionConfig } from "./types";
import { CapturePlan, DEFAULT_CAPTURE_PLAN } from "../capture/capturePlan";
import { framesReducer } from "./framesReducer";
import { useUploadQueue, queueSummary } from "./useUploadQueue";

interface SessionContextValue {
  config: SessionConfig | null;
  setConfig: (config: SessionConfig) => void;
  /** Target count and spacing, derived from the camera's real field of view.
   * Starts at the full-sensor 4:3 assumption and is corrected once the camera
   * reports what it can actually capture. */
  plan: CapturePlan;
  setPlan: (plan: CapturePlan) => void;
  frames: CaptureFrame[];
  addFrame: (frame: Omit<CaptureFrame, "status" | "attempts" | "terminal">) => void;
  retakeFrame: (frameId: string) => void;
  retryFrame: (frameId: string) => void;
  retryAllFailed: () => void;
  /** Clears captured frames only — used to restart the capture flow without losing the validated session. */
  clearFrames: () => void;
  /** Clears everything, including the session config — used when leaving the capture flow entirely. */
  reset: () => void;
  queue: ReturnType<typeof queueSummary>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [plan, setPlan] = useState<CapturePlan>(DEFAULT_CAPTURE_PLAN);
  const [frames, dispatch] = useReducer(framesReducer, []);

  useUploadQueue(config, frames, dispatch);

  const addFrame = useCallback((frame: Omit<CaptureFrame, "status" | "attempts" | "terminal">) => {
    dispatch({ type: "ADD_FRAME", frame: { ...frame, status: "pending", attempts: 0, terminal: false } });
  }, []);

  const retakeFrame = useCallback((frameId: string) => {
    dispatch({ type: "REMOVE_FRAME", frameId });
  }, []);

  const retryFrame = useCallback((frameId: string) => {
    dispatch({ type: "RETRY_FRAME", frameId });
  }, []);

  const retryAllFailed = useCallback(() => {
    frames.filter((f) => f.status === "failed").forEach((f) => dispatch({ type: "RETRY_FRAME", frameId: f.frameId }));
  }, [frames]);

  const clearFrames = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    setConfig(null);
  }, []);

  const queue = useMemo(() => queueSummary(frames), [frames]);

  const value = useMemo(
    () => ({ config, setConfig, plan, setPlan, frames, addFrame, retakeFrame, retryFrame, retryAllFailed, clearFrames, reset, queue }),
    [config, plan, frames, addFrame, retakeFrame, retryFrame, retryAllFailed, clearFrames, reset, queue],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}

export type UploadStatus = "pending" | "uploading" | "uploaded" | "failed";

export interface CaptureFrame {
  frameId: string;
  sequence: number;
  localUri: string;
  timestamp: number;
  yaw: number;
  pitch: number;
  roll: number;
  status: UploadStatus;
  attempts: number;
  /** Set once a terminal (non-retryable) server error is hit, e.g. session expired. */
  terminal: boolean;
  lastError?: string;
}

export interface SessionConfig {
  apiBase: string;
  token: string;
}

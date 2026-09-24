import { CaptureFrame, UploadStatus } from "./types";

export type FramesAction =
  | { type: "ADD_FRAME"; frame: CaptureFrame }
  | { type: "REMOVE_FRAME"; frameId: string }
  | { type: "SET_STATUS"; frameId: string; status: UploadStatus; error?: string; terminal?: boolean }
  | { type: "INCREMENT_ATTEMPTS"; frameId: string }
  | { type: "RETRY_FRAME"; frameId: string }
  | { type: "RESET" };

export function framesReducer(state: CaptureFrame[], action: FramesAction): CaptureFrame[] {
  switch (action.type) {
    case "ADD_FRAME":
      return [...state, action.frame];
    case "REMOVE_FRAME":
      return state.filter((f) => f.frameId !== action.frameId);
    case "SET_STATUS":
      return state.map((f) =>
        f.frameId === action.frameId
          ? { ...f, status: action.status, lastError: action.error, terminal: action.terminal ?? f.terminal }
          : f,
      );
    case "INCREMENT_ATTEMPTS":
      return state.map((f) => (f.frameId === action.frameId ? { ...f, attempts: f.attempts + 1 } : f));
    case "RETRY_FRAME":
      return state.map((f) =>
        f.frameId === action.frameId ? { ...f, status: "pending", terminal: false, lastError: undefined } : f,
      );
    case "RESET":
      return [];
    default:
      return state;
  }
}

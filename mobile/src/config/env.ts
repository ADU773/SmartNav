// Compile-time default backend base. This is a *development fallback only* —
// it is baked in at bundle time, so it cannot follow a change of laptop, Wi-Fi
// network or hotspot. At runtime the app prefers, in order:
//   1. the backend URL carried by the scanned session QR (session-scoped)
//   2. a manually configured server address (persisted on the device)
//   3. this value
export const DEFAULT_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || null;

export function normalizeApiBase(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  // Typing "192.168.1.20:5000" is the common case on a phone keyboard.
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function isPlausibleApiBase(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

export type ApiBaseSource = "session" | "manual" | "env" | "none";

export const API_BASE_SOURCE_LABEL: Record<ApiBaseSource, string> = {
  session: "from the scanned QR code",
  manual: "set on this device",
  env: "development default",
  none: "not configured",
};

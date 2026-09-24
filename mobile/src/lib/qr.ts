// Parses and validates a scanned QR payload into a session token plus an
// optional dev-convenience API base. Never trust the QR blindly: token must
// look like a real UUID and the api param (if present) must be a plausible
// http(s) origin — both are still validated against the backend afterwards
// by actually fetching the session.

export interface ParsedSessionQr {
  token: string;
  apiBaseUrl: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlausibleApiBase(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

/**
 * Accepts:
 *  - a bare UUID (dev convenience, typed or scanned from a plain QR)
 *  - `https://host[:port]/panorama-capture/<uuid>` (current browser URL), with
 *    an optional `?api=<encoded backend base>` query param
 *  - `smartnav://capture/<uuid>` (reserved for a future native deep link)
 * Returns null for anything else — the caller should show a
 * "not a SmartNav QR code" error rather than contacting the backend.
 */
export function parseSessionQr(raw: string): ParsedSessionQr | null {
  const value = raw.trim();
  if (!value) return null;

  if (UUID_RE.test(value)) {
    return { token: value, apiBaseUrl: null };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  const isSmartNavScheme = url.protocol === "smartnav:";
  if (!isHttp && !isSmartNavScheme) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  let token: string | undefined;

  if (isHttp) {
    const captureIndex = segments.indexOf("panorama-capture");
    if (captureIndex === -1 || !segments[captureIndex + 1]) return null;
    token = segments[captureIndex + 1];
  } else {
    // smartnav://capture/<uuid> — host is "capture", first path segment is the token.
    if (url.hostname !== "capture" || !segments[0]) return null;
    token = segments[0];
  }

  if (!token || !UUID_RE.test(token)) return null;

  const apiParam = url.searchParams.get("api");
  const apiBaseUrl = apiParam && isPlausibleApiBase(apiParam) ? apiParam.replace(/\/+$/, "") : null;

  return { token, apiBaseUrl };
}

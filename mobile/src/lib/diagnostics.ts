// Lightweight in-app diagnostics ring buffer.
//
// A failed upload on a physical device is otherwise invisible: the Metro
// terminal shows nothing useful for a native networking failure, and the
// backend only logs when it decides to. Every request records its outcome
// here so the Upload screen can show the real HTTP status and the backend's
// own message instead of a generic "failed".

export interface DiagnosticEntry {
  at: number;
  label: string;
  detail: string;
}

const MAX_ENTRIES = 50;
const entries: DiagnosticEntry[] = [];
const listeners = new Set<() => void>();

export function recordDiagnostic(label: string, detail: string) {
  entries.unshift({ at: Date.now(), label, detail });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  if (__DEV__) console.log(`[SmartNav] ${label}: ${detail}`);
  listeners.forEach((listener) => listener());
}

export function getDiagnostics(): DiagnosticEntry[] {
  return entries.slice();
}

export function clearDiagnostics() {
  entries.length = 0;
  listeners.forEach((listener) => listener());
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

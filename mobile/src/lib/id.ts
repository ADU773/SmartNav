// Lightweight unique id for frameId — only needs to be unique per session,
// not cryptographically random.
export function generateFrameId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `frame-${Date.now().toString(36)}-${random}`;
}

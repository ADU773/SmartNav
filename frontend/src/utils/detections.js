/**
 * Groups a scene's detected objects by label for display.
 *
 * Each group lists its detections most confident first, so the first click on
 * a label shows the clearest example. Only detections that carry a direction
 * can turn the camera; those from a remote detector are labels only.
 *
 * @param {{ label: string, confidence?: number, yawDeg?: number, pitchDeg?: number }[]} detections
 * @returns {{ label: string, count: number, items: object[], canLook: boolean }[]} most common first
 */
export function groupDetections(detections = []) {
  const groups = new Map();
  for (const detection of detections) {
    const label = detection?.label == null ? '' : String(detection.label);
    if (!label) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(detection);
  }
  return [...groups].map(([label, items]) => {
    const sorted = [...items].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return {
      label,
      count: sorted.length,
      items: sorted,
      canLook: sorted.some((item) => Number.isFinite(item.yawDeg)),
    };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The detection to show on the next click of a label: cycles through that
 * label's located instances, starting again at the most confident one.
 *
 * @param {{ items: object[] }} group - from groupDetections
 * @param {number} previousIndex - index shown last time, or -1
 * @returns {{ index: number, detection: object } | null}
 */
export function nextDetection(group, previousIndex = -1) {
  const located = group.items.filter((item) => Number.isFinite(item.yawDeg));
  if (located.length === 0) return null;
  const index = (previousIndex + 1) % located.length;
  return { index, detection: located[index] };
}

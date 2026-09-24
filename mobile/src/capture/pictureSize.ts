/**
 * SmartNav360 — Native picture size selection
 *
 * Panorama frames want the full sensor frame, not a cropped one: every degree
 * of horizontal field of view thrown away is a degree of overlap the stitcher
 * does not get.
 *
 * The two platforms report entirely different things here, so neither format
 * is assumed. iOS returns AVCaptureSession preset names, where `Photo` is the
 * full-sensor 4:3 still. Android returns concrete `WIDTHxHEIGHT` strings that
 * vary per device. Nothing is hard-coded to one handset; the list the device
 * reports is what gets searched.
 */

/** Full-sensor 4:3 still capture on iOS. */
const IOS_FULL_SENSOR = "Photo";
const IOS_HIGH = "High";

/** How close to 4:3 a reported size has to be to count as full-sensor. */
const ASPECT_TOLERANCE = 0.02;
/**
 * Upper bound on the long edge. Modern phones offer 48 MP+ modes whose files
 * are slow to encode, slow to upload and no more useful for feature matching
 * than a 12 MP frame.
 */
const MAX_LONG_EDGE = 4100;

export interface PictureSizeChoice {
  /** Value for CameraView's `pictureSize` prop, or null to keep the default. */
  pictureSize: string | null;
  reason: string;
}

function parseSize(value: string): { width: number; height: number } | null {
  const match = /^(\d+)\s*[xX]\s*(\d+)$/.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return { width, height };
}

function isFourThree({ width, height }: { width: number; height: number }): boolean {
  const longAxis = Math.max(width, height);
  const shortAxis = Math.min(width, height);
  return Math.abs(shortAxis / longAxis - 3 / 4) <= ASPECT_TOLERANCE;
}

/**
 * Picks the widest full-sensor still size the device offers.
 *
 * @param available - whatever `getAvailablePictureSizesAsync()` returned.
 */
export function selectPictureSize(available: string[]): PictureSizeChoice {
  if (!Array.isArray(available) || available.length === 0) {
    return { pictureSize: null, reason: "device reported no picture sizes; keeping the default" };
  }

  if (available.includes(IOS_FULL_SENSOR)) {
    return { pictureSize: IOS_FULL_SENSOR, reason: `"${IOS_FULL_SENSOR}" preset (full-sensor 4:3 still)` };
  }

  const dimensioned = available
    .map((value) => ({ value, size: parseSize(value) }))
    .filter((entry): entry is { value: string; size: { width: number; height: number } } => entry.size !== null);

  const fourThree = dimensioned
    .filter((entry) => isFourThree(entry.size))
    .filter((entry) => Math.max(entry.size.width, entry.size.height) <= MAX_LONG_EDGE)
    .sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height);

  if (fourThree.length > 0) {
    const best = fourThree[0];
    return { pictureSize: best.value, reason: `largest reported 4:3 size (${best.value})` };
  }

  if (available.includes(IOS_HIGH)) {
    return { pictureSize: IOS_HIGH, reason: `no 4:3 size reported; falling back to "${IOS_HIGH}"` };
  }

  const widest = dimensioned.sort(
    (a, b) => Math.min(b.size.width, b.size.height) / Math.max(b.size.width, b.size.height)
      - Math.min(a.size.width, a.size.height) / Math.max(a.size.width, a.size.height),
  )[0];
  if (widest) {
    return { pictureSize: widest.value, reason: `no 4:3 size reported; using the least-cropped (${widest.value})` };
  }

  return { pictureSize: null, reason: "no usable picture size reported; keeping the default" };
}

import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { recordDiagnostic } from "../lib/diagnostics";

// Practical upload size: large enough for ORB/feature-matching in the
// stitcher, small enough to upload quickly over LAN/cell.
const MAX_LONG_EDGE = 2600;
const JPEG_QUALITY = 0.82;

export interface ProcessedFrame {
  uri: string;
  width: number;
  height: number;
  rawWidth: number;
  rawHeight: number;
}

/**
 * Resizes and compresses a captured frame for upload.
 *
 * Resize and re-encode only. It does not crop, and it must not: the whole
 * point of capturing the full sensor frame is the horizontal field of view,
 * and cropping back to the screen shape here would throw away the overlap the
 * stitcher needs just as surely as cropping at capture time did.
 *
 * It does not rotate either. `CameraView.takePictureAsync()` already
 * orientation-corrects the image (`skipProcessing` is left false), so rotating
 * again would double-apply it and produce a sideways photo.
 *
 * The long edge is bounded rather than the width, so the output size does not
 * depend on whether the frame arrived portrait or landscape.
 */
export async function processFrame(uri: string, rawWidth: number, rawHeight: number): Promise<ProcessedFrame> {
  const longEdge = Math.max(rawWidth, rawHeight);
  const scale = longEdge > 0 ? Math.min(1, MAX_LONG_EDGE / longEdge) : 1;
  const targetWidth = Math.max(1, Math.round(rawWidth * scale));

  const context = ImageManipulator.manipulate(uri);
  // Width only: the height follows to preserve the aspect ratio.
  context.resize({ width: targetWidth });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });

  const rawAspect = rawHeight ? rawWidth / rawHeight : 0;
  const processedAspect = result.height ? result.width / result.height : 0;
  recordDiagnostic(
    "frame processing",
    `raw ${rawWidth}x${rawHeight} (aspect ${rawAspect.toFixed(3)}) -> processed ${result.width}x${result.height} (aspect ${processedAspect.toFixed(3)})`,
  );
  if (rawAspect && Math.abs(processedAspect - rawAspect) > 0.01) {
    recordDiagnostic(
      "frame processing",
      `WARNING aspect changed during processing: ${rawAspect.toFixed(3)} -> ${processedAspect.toFixed(3)}`,
    );
  }

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    rawWidth,
    rawHeight,
  };
}

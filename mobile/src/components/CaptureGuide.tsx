import { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  AlignmentState,
  GuidancePhase,
  PHASE_LABEL,
  PITCH_TOLERANCE_DEG,
  clamp,
} from "../capture/guidance";
import type { OrientationSample } from "../capture/guidance";
import { colors } from "../theme";

/**
 * Guided-capture overlay.
 *
 * The 12 yaw targets still drive capture, but they no longer dominate the
 * screen: progress lives in a compact top strip, and the centre of the frame
 * is given over to framing aids that keep consecutive shots at the same height
 * and tilt. Vertical drift and roll between neighbouring frames are what make
 * a panorama hard to stitch, so they are what the overlay makes obvious.
 *
 * Everything here is advisory. The stitcher still decides real alignment.
 */

/** Screen pixels of horizon travel per degree of pitch error. */
const PITCH_PIXELS_PER_DEG = 4.5;
/** Segments used to fake a gently curved corridor rail without an SVG dependency. */
const RAIL_SEGMENTS = 13;
/** Vertical dip, in pixels, at the far ends of each rail. */
const RAIL_CURVE_PX = 14;

const PHASE_COLOR: Record<GuidancePhase, string> = {
  seek: colors.textMuted,
  near: colors.warning,
  tilt: colors.warning,
  hold: colors.primary,
  ready: colors.success,
  capturing: colors.success,
  complete: colors.success,
};

interface Props {
  orientation: OrientationSample;
  alignment: AlignmentState;
  capturedCount: number;
  capturedIndices: Set<number>;
  currentIndex: number | null;
  /** Comes from the capture plan, which follows the camera's field of view. */
  targetCount: number;
}

export function CaptureGuide({
  orientation,
  alignment,
  capturedCount,
  capturedIndices,
  currentIndex,
  targetCount,
}: Props) {
  // The overlay fills the camera viewport, which is laid out at the sensor's
  // 3:4 aspect, so it measures itself rather than the screen.
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const width = layout.width || 1;
  const accent = PHASE_COLOR[alignment.phase];

  const frameWidth = Math.max(80, Math.min(width * 0.62, 240));
  const frameHeight = Math.min(frameWidth * 1.15, (layout.height || frameWidth) * 0.52);

  const rails = useMemo(() => buildRail(width), [width]);

  // Live horizon: vertical offset from pitch error, rotation from roll. When
  // the phone is upright and level it lands exactly on the fixed reference
  // line, which is the whole point — one unambiguous target to match.
  const horizonOffset = clamp(-orientation.pitchDeg * PITCH_PIXELS_PER_DEG, -140, 140);
  const horizonRotation = clamp(orientation.rollDeg, -45, 45);

  return (
    <View
      style={styles.root}
      pointerEvents="none"
      onLayout={(event) => setLayout(event.nativeEvent.layout)}
    >
      <View style={styles.progressBlock}>
        <Text style={styles.progressCount}>
          {capturedCount} <Text style={styles.progressTotal}>/ {targetCount}</Text>
        </Text>
        <View style={styles.markerRow}>
          {Array.from({ length: targetCount }, (_, i) => (
            <View
              key={i}
              style={[
                styles.marker,
                capturedIndices.has(i) && styles.markerCaptured,
                i === currentIndex && [styles.markerCurrent, { backgroundColor: accent }],
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.stage}>
        {/* Corridor rails: the band consecutive frames should share. */}
        <View style={[styles.railLayer, { transform: [{ translateY: -frameHeight / 2 }] }]}>
          {rails.map((segment, i) => (
            <View
              key={`top-${i}`}
              style={[styles.railSegment, { left: segment.left, width: segment.width, top: segment.dip, opacity: segment.opacity }]}
            />
          ))}
        </View>
        <View style={[styles.railLayer, { transform: [{ translateY: frameHeight / 2 }] }]}>
          {rails.map((segment, i) => (
            <View
              key={`bottom-${i}`}
              style={[styles.railSegment, { left: segment.left, width: segment.width, top: -segment.dip, opacity: segment.opacity }]}
            />
          ))}
        </View>

        {/* Fixed reference line — where the horizon belongs. */}
        <View style={styles.referenceLine} />
        <View style={styles.referenceTickLeft} />
        <View style={styles.referenceTickRight} />

        {/* Live horizon driven by gravity: matching it to the reference line
            levels both pitch and roll at once. */}
        <View
          style={[
            styles.horizon,
            {
              backgroundColor: alignment.pitchOff || alignment.rollOff ? colors.warning : colors.success,
              transform: [{ translateY: horizonOffset }, { rotate: `${horizonRotation}deg` }],
            },
          ]}
        />

        {/* Framing reticle. */}
        <View style={[styles.frame, { width: frameWidth, height: frameHeight, borderColor: accent }]}>
          <View style={[styles.corner, styles.cornerTopLeft, { borderColor: accent }]} />
          <View style={[styles.corner, styles.cornerTopRight, { borderColor: accent }]} />
          <View style={[styles.corner, styles.cornerBottomLeft, { borderColor: accent }]} />
          <View style={[styles.corner, styles.cornerBottomRight, { borderColor: accent }]} />
        </View>

        {/* Turn direction. */}
        {alignment.turn !== "none" && (
          <View style={[styles.turnBadge, alignment.turn === "left" ? styles.turnLeft : styles.turnRight]}>
            <Text style={[styles.turnGlyph, { color: accent }]}>{alignment.turn === "left" ? "‹‹" : "››"}</Text>
            <Text style={styles.turnDegrees}>{Math.round(Math.abs(alignment.yawErrorDeg))}°</Text>
          </View>
        )}
      </View>

      <View style={styles.statusBlock}>
        <View style={[styles.statusPill, { borderColor: accent }]}>
          <View style={[styles.statusDot, { backgroundColor: accent }]} />
          <Text style={styles.statusText}>{PHASE_LABEL[alignment.phase]}</Text>
        </View>
        {(alignment.pitchOff || alignment.rollOff) && (
          <Text style={[styles.tiltHint, alignment.tiltSevere && styles.tiltHintSevere]}>
            {tiltHint(orientation, alignment)}
          </Text>
        )}
      </View>
    </View>
  );
}

function tiltHint(orientation: OrientationSample, alignment: AlignmentState): string {
  const parts: string[] = [];
  if (alignment.pitchOff) {
    parts.push(orientation.pitchDeg > PITCH_TOLERANCE_DEG ? "tilt down" : "tilt up");
  }
  if (alignment.rollOff) parts.push("straighten");
  return parts.join(" · ");
}

function buildRail(width: number) {
  const usable = width - 16;
  const segmentWidth = usable / RAIL_SEGMENTS;
  return Array.from({ length: RAIL_SEGMENTS }, (_, i) => {
    // Normalised distance from centre, -1 … 1.
    const t = (i + 0.5) / RAIL_SEGMENTS * 2 - 1;
    return {
      left: 8 + i * segmentWidth,
      width: segmentWidth - 3,
      dip: t * t * RAIL_CURVE_PX,
      // Fade towards the edges so the corridor reads as receding, not as a box.
      opacity: 0.85 - Math.abs(t) * 0.55,
    };
  });
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "space-between" },

  progressBlock: { alignItems: "center", paddingTop: 12, gap: 6 },
  progressCount: { color: colors.text, fontSize: 18, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  progressTotal: { color: colors.textMuted, fontSize: 15, fontWeight: "600" },
  markerRow: { flexDirection: "row", gap: 4, flexWrap: "wrap", justifyContent: "center", paddingHorizontal: 12 },
  marker: { width: 10, height: 4, borderRadius: 2, backgroundColor: "rgba(242,245,250,0.3)" },
  markerCaptured: { backgroundColor: colors.success },
  markerCurrent: { height: 6, borderRadius: 3, marginTop: -1 },

  stage: { flex: 1, alignItems: "center", justifyContent: "center" },

  railLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center" },
  railSegment: { position: "absolute", height: 2, borderRadius: 1, backgroundColor: colors.text },

  referenceLine: {
    position: "absolute",
    left: 40,
    right: 40,
    height: 1,
    backgroundColor: "rgba(242,245,250,0.45)",
  },
  referenceTickLeft: { position: "absolute", left: 40, width: 2, height: 14, backgroundColor: "rgba(242,245,250,0.45)" },
  referenceTickRight: { position: "absolute", right: 40, width: 2, height: 14, backgroundColor: "rgba(242,245,250,0.45)" },

  horizon: { position: "absolute", left: 56, right: 56, height: 2, borderRadius: 1 },

  frame: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, opacity: 0.9 },
  corner: { position: "absolute", width: 22, height: 22, borderColor: colors.text },
  cornerTopLeft: { top: -1, left: -1, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 18 },
  cornerTopRight: { top: -1, right: -1, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 18 },
  cornerBottomLeft: { bottom: -1, left: -1, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 18 },
  cornerBottomRight: { bottom: -1, right: -1, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 18 },

  turnBadge: { position: "absolute", alignItems: "center", gap: 2 },
  turnLeft: { left: 12 },
  turnRight: { right: 12 },
  turnGlyph: { fontSize: 30, fontWeight: "700" },
  turnDegrees: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },

  statusBlock: { alignItems: "center", gap: 6, paddingBottom: 12 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "rgba(11,18,32,0.75)",
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  tiltHint: { color: colors.warning, fontSize: 12, fontWeight: "600" },
  tiltHintSevere: { color: colors.danger },
});

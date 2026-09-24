import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, useWindowDimensions } from "react-native";
import { CameraView } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useSession } from "../state/SessionProvider";
import { useDeviceOrientation } from "../capture/useDeviceOrientation";
import { processFrame } from "../capture/processFrame";
import { selectPictureSize } from "../capture/pictureSize";
import {
  NATIVE_PORTRAIT_ASPECT,
  describePlan,
  planFromFrameSize,
  targetYawsDeg,
} from "../capture/capturePlan";
import { generateFrameId } from "../lib/id";
import { recordDiagnostic } from "../lib/diagnostics";
import {
  angleDiffDeg,
  evaluateAlignment,
  AUTO_CAPTURE_TICK_MS,
  DUPLICATE_CAPTURE_GUARD_MS,
  DUPLICATE_YAW_GUARD_FRACTION,
} from "../capture/guidance";
import { CaptureGuide } from "../components/CaptureGuide";
import { ThumbnailStrip } from "../components/ThumbnailStrip";
import { colors } from "../theme";

function nextTargetIndex(captured: Set<number>, targetCount: number): number | null {
  for (let i = 0; i < targetCount; i++) {
    if (!captured.has(i)) return i;
  }
  return null;
}

export default function Capture() {
  useKeepAwake();
  const { config, plan, setPlan, frames, addFrame, retakeFrame, clearFrames } = useSession();
  const { orientation, orientationRef, resetYaw } = useDeviceOrientation(true);
  const cameraRef = useRef<CameraView>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [frameTargets, setFrameTargets] = useState<Record<string, number>>({});
  const [semiAuto, setSemiAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const targets = useMemo(() => targetYawsDeg(plan.targetCount), [plan.targetCount]);

  // The auto-capture state machine runs off refs on a fixed tick. Deriving it
  // from React state instead would make it depend on render timing: a stale
  // closure or a missed dependency silently stops it firing.
  const capturingRef = useRef(false);
  const lastCaptureAtRef = useRef(0);
  const sequenceRef = useRef(0);
  const capturedIndicesRef = useRef<Set<number>>(new Set());
  const capturedYawsRef = useRef<number[]>([]);
  const semiAutoRef = useRef(semiAuto);
  const targetsRef = useRef(targets);
  const planRef = useRef(plan);

  useEffect(() => {
    semiAutoRef.current = semiAuto;
  }, [semiAuto]);
  useEffect(() => {
    targetsRef.current = targets;
    planRef.current = plan;
  }, [targets, plan]);

  /**
   * The camera viewport is laid out at the sensor's own 3:4 aspect, not
   * stretched to fill the screen.
   *
   * This is not only so the preview matches the photo. expo-camera on iOS
   * crops every captured still to the aspect ratio of the preview view
   * (CameraPhotoCapture.swift calls AVMakeRect with the preview layer's size),
   * so a full-screen preview on a 19.5:9 phone silently threw away about a
   * third of the sensor's horizontal field of view — and with it the overlap
   * the stitcher needs. Laying the view out at 3:4 is what keeps the full
   * frame.
   */
  const viewport = useMemo(() => {
    const maxHeight = screenHeight * 0.62;
    const widthFromHeight = maxHeight * NATIVE_PORTRAIT_ASPECT;
    const width = Math.min(screenWidth, widthFromHeight);
    return { width, height: width / NATIVE_PORTRAIT_ASPECT };
  }, [screenWidth, screenHeight]);

  const handleCameraReady = useCallback(async () => {
    try {
      const available = await cameraRef.current?.getAvailablePictureSizesAsync();
      const choice = selectPictureSize(available ?? []);
      recordDiagnostic(
        "camera",
        `available picture sizes: ${(available ?? []).join(", ") || "(none)"}`,
      );
      recordDiagnostic("camera", `selected picture size: ${choice.pictureSize ?? "default"} — ${choice.reason}`);
      if (choice.pictureSize) setPictureSize(choice.pictureSize);
    } catch (error) {
      recordDiagnostic("camera", `could not read picture sizes — ${String(error)}`);
    }
  }, []);

  const capturedIndices = useMemo(() => {
    const captured = new Set<number>();
    for (const frame of frames) {
      const index = frameTargets[frame.frameId];
      if (index !== undefined) captured.add(index);
    }
    return captured;
  }, [frames, frameTargets]);

  useEffect(() => {
    capturedIndicesRef.current = capturedIndices;
  }, [capturedIndices]);

  useEffect(() => {
    capturedYawsRef.current = frames.map((frame) => frame.yaw);
  }, [frames]);

  const currentTargetIndex = useMemo(
    () => nextTargetIndex(capturedIndices, plan.targetCount),
    [capturedIndices, plan.targetCount],
  );

  const alignment = useMemo(
    () =>
      evaluateAlignment(orientation, currentTargetIndex === null ? null : targets[currentTargetIndex], {
        capturing: busy,
        nearToleranceDeg: plan.spacingDeg * 0.6,
      }),
    [orientation, currentTargetIndex, targets, busy, plan.spacingDeg],
  );

  const capturePhoto = useCallback(
    async (targetIndex: number | null) => {
      if (capturingRef.current || !cameraRef.current || !config) return;
      capturingRef.current = true;
      setBusy(true);
      // Freeze the orientation that framed this shot, before the shutter delay
      // lets the phone drift.
      const shotOrientation = orientationRef.current;
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
        if (!photo) return;
        const processed = await processFrame(photo.uri, photo.width, photo.height);

        // The first frame reveals what the camera really produces, so the plan
        // is corrected against it rather than against an assumption.
        if (sequenceRef.current === 0) {
          const measured = planFromFrameSize(processed.width, processed.height);
          recordDiagnostic("capture plan", `${describePlan(measured)} (aspect ${measured.aspect?.toFixed(3)})`);
          if (measured.cropped) {
            recordDiagnostic(
              "capture plan",
              `WARNING frame aspect ${measured.aspect?.toFixed(3)} is not the full 3:4 sensor frame`,
            );
          }
          if (measured.targetCount !== planRef.current.targetCount) {
            recordDiagnostic(
              "capture plan",
              `adjusted from ${planRef.current.targetCount} to ${measured.targetCount} targets`,
            );
            setPlan(measured);
          }
        }

        const frameId = generateFrameId();
        const sequence = sequenceRef.current++;
        addFrame({
          frameId,
          sequence,
          localUri: processed.uri,
          timestamp: Date.now(),
          yaw: shotOrientation.yawDeg,
          pitch: shotOrientation.pitchDeg,
          roll: shotOrientation.rollDeg,
        });
        if (targetIndex !== null) {
          setFrameTargets((prev) => ({ ...prev, [frameId]: targetIndex }));
        }
        lastCaptureAtRef.current = Date.now();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (error) {
        recordDiagnostic("capture", `takePicture failed — ${String(error)}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } finally {
        capturingRef.current = false;
        setBusy(false);
      }
    },
    [config, addFrame, orientationRef, setPlan],
  );

  const capturePhotoRef = useRef(capturePhoto);
  useEffect(() => {
    capturePhotoRef.current = capturePhoto;
  }, [capturePhoto]);

  // Semi-automatic capture.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!semiAutoRef.current || capturingRef.current) return;
      if (Date.now() - lastCaptureAtRef.current < DUPLICATE_CAPTURE_GUARD_MS) return;

      const currentPlan = planRef.current;
      const targetIndex = nextTargetIndex(capturedIndicesRef.current, currentPlan.targetCount);
      if (targetIndex === null) return;

      const sample = orientationRef.current;
      const state = evaluateAlignment(sample, targetsRef.current[targetIndex], {
        nearToleranceDeg: currentPlan.spacingDeg * 0.6,
      });
      if (state.phase !== "ready") return;

      // Never stack two frames on the same spot, even if the target bookkeeping
      // and the physical world disagree.
      const guard = currentPlan.spacingDeg * DUPLICATE_YAW_GUARD_FRACTION;
      const tooClose = capturedYawsRef.current.some(
        (yaw) => Math.abs(angleDiffDeg(sample.yawDeg, yaw)) < guard,
      );
      if (tooClose) return;

      capturePhotoRef.current(targetIndex);
    }, AUTO_CAPTURE_TICK_MS);
    return () => clearInterval(timer);
  }, [orientationRef]);

  const handleRetake = useCallback(
    (frameId: string) => {
      retakeFrame(frameId);
      setFrameTargets((prev) => {
        const next = { ...prev };
        delete next[frameId];
        return next;
      });
    },
    [retakeFrame],
  );

  const handleRestart = useCallback(() => {
    clearFrames();
    setFrameTargets({});
    sequenceRef.current = 0;
    lastCaptureAtRef.current = 0;
    capturedYawsRef.current = [];
    capturedIndicesRef.current = new Set();
    resetYaw();
  }, [clearFrames, resetYaw]);

  return (
    <View style={styles.container}>
      <View style={styles.viewportWrap}>
        <View style={[styles.viewport, { width: viewport.width, height: viewport.height }]}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            pictureSize={pictureSize}
            onCameraReady={handleCameraReady}
          />
          {/* Guidance sits inside the viewport so what it marks up is what the
              photograph will contain. */}
          <CaptureGuide
            orientation={orientation}
            alignment={alignment}
            capturedCount={capturedIndices.size}
            capturedIndices={capturedIndices}
            currentIndex={currentTargetIndex}
            targetCount={plan.targetCount}
          />
        </View>
      </View>

      <View style={styles.topBar}>
        <Text style={styles.frameCount}>
          {frames.length} frame{frames.length === 1 ? "" : "s"}
        </Text>
        <View style={styles.autoToggle}>
          <Text style={styles.autoLabel}>Auto</Text>
          <Switch value={semiAuto} onValueChange={setSemiAuto} />
        </View>
      </View>

      {!orientation.available && (
        <View style={styles.sensorWarning}>
          <Text style={styles.sensorWarningText}>
            Motion sensors unavailable — use the shutter manually and turn about{" "}
            {Math.round(plan.spacingDeg)}° between shots.
          </Text>
        </View>
      )}

      <View style={styles.bottomBar}>
        <ThumbnailStrip frames={frames} onRetake={handleRetake} />

        <View style={styles.controls}>
          <Pressable style={styles.secondaryButton} onPress={handleRestart}>
            <Text style={styles.secondaryButtonText}>Restart</Text>
          </Pressable>

          <Pressable
            style={[styles.shutter, busy && styles.shutterBusy]}
            onPress={() => capturePhoto(currentTargetIndex)}
            disabled={busy}
          >
            <View style={styles.shutterInner} />
          </Pressable>

          <Pressable
            style={[styles.secondaryButton, frames.length === 0 && styles.disabled]}
            disabled={frames.length === 0}
            onPress={() => router.push("/review")}
          >
            <Text style={styles.secondaryButtonText}>Review</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  viewportWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 72 },
  viewport: { overflow: "hidden", borderRadius: 14, backgroundColor: "black" },
  topBar: {
    position: "absolute",
    top: 56,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  frameCount: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "rgba(11,18,32,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  autoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(11,18,32,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  autoLabel: { color: colors.text, fontSize: 13 },
  sensorWarning: {
    position: "absolute",
    top: 100,
    left: 16,
    right: 16,
    backgroundColor: "rgba(242,184,75,0.15)",
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  sensorWarningText: { color: colors.warning, fontSize: 12 },
  bottomBar: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, gap: 12 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterBusy: { opacity: 0.5 },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.text },
  secondaryButton: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.4 },
});

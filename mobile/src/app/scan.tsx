import { useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions, BarcodeScanningResult } from "expo-camera";
import { router } from "expo-router";
import { parseSessionQr } from "../lib/qr";
import { getSession, ApiError } from "../lib/api";
import { useSession } from "../state/SessionProvider";
import { useServer } from "../state/ServerProvider";
import { colors } from "../theme";

type ValidationState = "scanning" | "validating" | "error";

export default function Scan() {
  const { setConfig } = useSession();
  const { apiBase: configuredApiBase, setSessionApiBase } = useServer();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ValidationState>("scanning");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Guards against the scanner firing repeatedly while we validate/navigate.
  const handlingRef = useRef(false);

  const resetToScanning = () => {
    handlingRef.current = false;
    setState("scanning");
    setErrorMessage(null);
  };

  const handleScan = async (result: BarcodeScanningResult) => {
    if (handlingRef.current) return;
    handlingRef.current = true;

    const parsed = parseSessionQr(result.data);
    if (!parsed) {
      setErrorMessage("That's not a SmartNav capture QR code.");
      setState("error");
      return;
    }

    // A backend address carried by the QR wins, but only for this session —
    // it is never written to storage without an explicit choice on the Server
    // screen. Otherwise fall back to the configured/default address.
    const apiBase = parsed.apiBaseUrl || configuredApiBase;
    if (!apiBase) {
      setErrorMessage("No server address configured. Set one under Server on the home screen.");
      setState("error");
      return;
    }

    setState("validating");
    try {
      const session = await getSession(apiBase, parsed.token);
      if (session.status === "done") {
        setErrorMessage("This capture session has already been completed.");
        setState("error");
        return;
      }
      setSessionApiBase(parsed.apiBaseUrl);
      setConfig({ apiBase, token: parsed.token });
      router.replace("/briefing");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setErrorMessage("This session is unknown or has expired. Ask the desktop app for a fresh QR code.");
      } else if (error instanceof ApiError) {
        setErrorMessage(`Couldn't reach the SmartNav backend at ${apiBase}. ${error.detail}`);
      } else {
        setErrorMessage("Couldn't reach the SmartNav backend. Check your network and try again.");
      }
      setState("error");
    }
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.body}>
          {permission.canAskAgain
            ? "SmartNav needs the camera to scan the session QR code."
            : "Camera access was denied. Enable it in your device Settings to scan a QR code."}

        </Text>
        {permission.canAskAgain && (
          <Pressable style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Grant camera access</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={state === "scanning" ? handleScan : undefined}
      />
      <View style={styles.frame} pointerEvents="none" />

      {state === "validating" && (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.overlayText}>Validating session…</Text>
        </View>
      )}

      {state === "error" && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Couldn&apos;t start capture</Text>
          <Text style={styles.overlayText}>{errorMessage}</Text>
          <Pressable style={styles.primaryButton} onPress={resetToScanning}>
            <Text style={styles.primaryButtonText}>Scan again</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/settings")}>
            <Text style={styles.linkText}>Change server address</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  center: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  frame: {
    position: "absolute",
    top: "30%",
    left: "15%",
    right: "15%",
    bottom: "40%",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 16,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(11,18,32,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  overlayTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  overlayText: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  body: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14, marginTop: 8 },
  primaryButtonText: { color: colors.primaryText, fontSize: 15, fontWeight: "600" },
  linkText: { color: colors.primary, fontSize: 13, fontWeight: "600", marginTop: 4 },
});

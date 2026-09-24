import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { useServer } from "../state/ServerProvider";
import { useSession } from "../state/SessionProvider";
import { describePlan } from "../capture/capturePlan";
import { API_BASE_SOURCE_LABEL, DEFAULT_API_BASE_URL } from "../config/env";
import { getDiagnostics, subscribeDiagnostics, clearDiagnostics, DiagnosticEntry } from "../lib/diagnostics";
import { colors } from "../theme";

export default function Settings() {
  const { apiBase, source, manualApiBase, sessionApiBase, saveManualApiBase, clearManualApiBase, rememberSessionApiBase } =
    useServer();
  const [draft, setDraft] = useState(manualApiBase || "");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { plan } = useSession();
  const [log, setLog] = useState<DiagnosticEntry[]>(getDiagnostics);

  useEffect(() => subscribeDiagnostics(() => setLog(getDiagnostics())), []);

  const save = async () => {
    setChecking(true);
    setError(null);
    setMessage(null);
    try {
      await saveManualApiBase(draft);
      setMessage("Server reachable and saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that address.");
    } finally {
      setChecking(false);
    }
  };

  const forget = async () => {
    setError(null);
    setMessage(null);
    await clearManualApiBase();
    setDraft("");
  };

  const remember = async () => {
    setError(null);
    await rememberSessionApiBase();
    setDraft(sessionApiBase || "");
    setMessage("Saved this session's server as the default.");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Currently using</Text>
        <Text style={styles.currentValue}>{apiBase || "No server configured"}</Text>
        <Text style={styles.currentSource}>{API_BASE_SOURCE_LABEL[source]}</Text>
      </View>

      {sessionApiBase && sessionApiBase !== manualApiBase && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>This session&apos;s server</Text>
          <Text style={styles.body}>
            The scanned QR code pointed at {sessionApiBase}. It is used for this session only unless you save it.
          </Text>
          <Pressable style={styles.secondaryButton} onPress={remember}>
            <Text style={styles.secondaryButtonText}>Save as default</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Server address</Text>
        <Text style={styles.body}>
          Enter the address of the laptop running the SmartNav backend, for example 192.168.1.20:5000. The phone and
          the laptop must be on the same Wi-Fi network or hotspot.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="192.168.1.20:5000"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {error && <Text style={styles.error}>{error}</Text>}
        {message && <Text style={styles.success}>{message}</Text>}
        <Pressable style={[styles.primaryButton, checking && styles.disabled]} disabled={checking} onPress={save}>
          {checking ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.primaryButtonText}>Test and save</Text>
          )}
        </Pressable>
        {manualApiBase && (
          <Pressable style={styles.secondaryButton} onPress={forget}>
            <Text style={styles.secondaryButtonText}>Forget saved address</Text>
          </Pressable>
        )}
        {DEFAULT_API_BASE_URL && (
          <Text style={styles.footnote}>Build-time fallback: {DEFAULT_API_BASE_URL}</Text>
        )}
      </View>

      {/* Capture geometry is the thing that decides whether the desktop
          stitcher can register frames at all, so the planned numbers are
          visible here rather than only in code. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Capture plan</Text>
        <Text style={styles.currentValue}>{describePlan(plan)}</Text>
        <Text style={styles.body}>
          {plan.aspect === null
            ? "Assuming a full 3:4 sensor frame until the camera reports otherwise."
            : `Measured from a ${plan.aspect.toFixed(3)} aspect frame${plan.cropped ? " — this is narrower than the full 3:4 sensor frame, so more shots are planned to keep the overlap." : "."}`}
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.logHeader}>
          <Text style={styles.cardTitle}>Capture and network diagnostics</Text>
          <Pressable onPress={clearDiagnostics}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>
        {log.length === 0 ? (
          <Text style={styles.body}>Nothing recorded yet.</Text>
        ) : (
          log.slice(0, 20).map((entry) => (
            <View key={`${entry.at}-${entry.label}`} style={styles.logRow}>
              <Text style={styles.logLabel} numberOfLines={1}>
                {entry.label}
              </Text>
              <Text style={styles.logDetail}>{entry.detail}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 10 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  currentValue: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  currentSource: { color: colors.textMuted, fontSize: 13 },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
  },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: colors.primaryText, fontSize: 15, fontWeight: "600" },
  secondaryButton: { backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
  success: { color: colors.success, fontSize: 13 },
  footnote: { color: colors.textMuted, fontSize: 11 },
  disabled: { opacity: 0.6 },
  logHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  clearText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  logRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 2 },
  logLabel: { color: colors.text, fontSize: 12, fontWeight: "600" },
  logDetail: { color: colors.textMuted, fontSize: 12 },
});

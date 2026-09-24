import { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput } from "react-native";
import { router } from "expo-router";
import { API_BASE_SOURCE_LABEL } from "../config/env";
import { parseSessionQr } from "../lib/qr";
import { useSession } from "../state/SessionProvider";
import { useServer } from "../state/ServerProvider";
import { colors } from "../theme";

export default function Home() {
  const { setConfig } = useSession();
  const { apiBase, source, setSessionApiBase } = useServer();
  const [devOpen, setDevOpen] = useState(false);
  const [devToken, setDevToken] = useState("");
  const [devError, setDevError] = useState<string | null>(null);

  const startDevSession = () => {
    setDevError(null);
    const parsed = parseSessionQr(devToken.trim());
    if (!parsed) {
      setDevError("Enter a valid session UUID or capture link.");
      return;
    }
    const resolved = parsed.apiBaseUrl || apiBase;
    if (!resolved) {
      setDevError("No server configured. Set one under Server first.");
      return;
    }
    if (parsed.apiBaseUrl) setSessionApiBase(parsed.apiBaseUrl);
    setConfig({ apiBase: resolved, token: parsed.token });
    router.push("/briefing");
  };

  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <View style={styles.logoDot} />
        <Text style={styles.title}>SmartNav</Text>
        <Text style={styles.subtitle}>Panorama Capture</Text>
      </View>

      <Text style={styles.body}>
        Scan the QR code shown on the SmartNav desktop app to start a guided 360° capture session.
      </Text>

      <Pressable style={styles.primaryButton} onPress={() => router.push("/scan")}>
        <Text style={styles.primaryButtonText}>Scan QR Code</Text>
      </Pressable>

      <Pressable style={styles.serverCard} onPress={() => router.push("/settings")}>
        <View style={styles.serverTextBlock}>
          <Text style={styles.serverLabel}>Server</Text>
          <Text style={styles.serverValue} numberOfLines={1}>
            {apiBase || "Not configured — tap to set"}
          </Text>
          <Text style={styles.serverSource}>{API_BASE_SOURCE_LABEL[source]}</Text>
        </View>
        <Text style={styles.serverChevron}>›</Text>
      </Pressable>

      <Pressable onPress={() => setDevOpen((v) => !v)} style={styles.devToggle}>
        <Text style={styles.devToggleText}>{devOpen ? "Hide manual entry" : "Enter session manually"}</Text>
      </Pressable>

      {devOpen && (
        <View style={styles.devPanel}>
          <TextInput
            style={styles.input}
            placeholder="Session UUID or capture link"
            placeholderTextColor={colors.textMuted}
            value={devToken}
            onChangeText={setDevToken}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {devError && <Text style={styles.error}>{devError}</Text>}
          <Pressable style={styles.secondaryButton} onPress={startDevSession}>
            <Text style={styles.secondaryButtonText}>Continue</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: "center", gap: 16 },
  brand: { alignItems: "center", marginBottom: 24, gap: 4 },
  logoDot: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted },
  body: { fontSize: 15, color: colors.textMuted, textAlign: "center", lineHeight: 22 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  primaryButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
  serverCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  serverTextBlock: { flex: 1, gap: 2 },
  serverLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  serverValue: { color: colors.text, fontSize: 14, fontWeight: "600" },
  serverSource: { color: colors.textMuted, fontSize: 12 },
  serverChevron: { color: colors.textMuted, fontSize: 24 },
  devToggle: { alignItems: "center", marginTop: 4 },
  devToggleText: { color: colors.textMuted, fontSize: 13 },
  devPanel: { gap: 10, marginTop: 8 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 13 },
  secondaryButton: { backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
});

import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from "react-native";
import { router } from "expo-router";
import { useSession } from "../state/SessionProvider";
import { completeSession as completeSessionRequest } from "../lib/api";
import { colors } from "../theme";

export default function Upload() {
  const { config, frames, queue, retryFrame, retryAllFailed } = useSession();
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const uploaded = frames.filter((f) => f.status === "uploaded").length;
  const failedFrames = frames.filter((f) => f.status === "failed");

  const canFinish = queue.drained && !finishing;

  const finish = async () => {
    if (!config) return;
    setFinishing(true);
    setFinishError(null);
    try {
      await completeSessionRequest(config.apiBase, config.token);
      router.replace("/complete");
    } catch {
      setFinishError("Couldn't mark the session complete. Check your connection and try again.");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.progressCard}>
        <Text style={styles.progressText}>
          {uploaded} / {frames.length} uploaded
        </Text>
        {!queue.drained && <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />}
        {queue.drained && failedFrames.length === 0 && <Text style={styles.success}>All frames uploaded.</Text>}
      </View>

      {failedFrames.length > 0 && (
        <View style={styles.failedCard}>
          <Text style={styles.failedTitle}>
            {failedFrames.length} frame{failedFrames.length === 1 ? "" : "s"} failed to upload
          </Text>
          <FlatList
            data={failedFrames}
            keyExtractor={(f) => f.frameId}
            renderItem={({ item }) => (
              <View style={styles.failedRow}>
                <View style={styles.failedRowTextBlock}>
                  <Text style={styles.failedRowText} numberOfLines={1}>
                    Frame {item.sequence + 1}
                    {item.terminal ? " — rejected by the server" : ""}
                  </Text>
                  {/* The backend's own status and message: without this a
                      device-side failure is undiagnosable. */}
                  {item.lastError && (
                    <Text style={styles.failedReason} numberOfLines={3}>
                      {item.lastError}
                    </Text>
                  )}
                </View>
                <Pressable onPress={() => retryFrame(item.frameId)} style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            )}
          />
          <Pressable style={styles.retryAllButton} onPress={retryAllFailed}>
            <Text style={styles.retryButtonText}>Retry all</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/settings")}>
            <Text style={styles.linkText}>Check server address and network log</Text>
          </Pressable>
          <Text style={styles.warning}>
            Finishing now will exclude these frames from the panorama.
          </Text>
        </View>
      )}

      {finishError && <Text style={styles.error}>{finishError}</Text>}

      <Pressable style={[styles.primaryButton, !canFinish && styles.disabled]} disabled={!canFinish} onPress={finish}>
        {finishing ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.primaryButtonText}>Finish Session</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 16 },
  progressCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 20, alignItems: "center" },
  progressText: { color: colors.text, fontSize: 18, fontWeight: "700" },
  success: { color: colors.success, marginTop: 8 },
  failedCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, gap: 8 },
  failedTitle: { color: colors.warning, fontSize: 14, fontWeight: "700" },
  failedRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 8 },
  failedRowTextBlock: { flex: 1, gap: 2 },
  failedRowText: { color: colors.text, fontSize: 13 },
  failedReason: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  linkText: { color: colors.primary, fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: 2 },
  retryButton: { backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  retryAllButton: { backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingVertical: 8, alignItems: "center", marginTop: 4 },
  retryButtonText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  warning: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: "auto" },
  primaryButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.4 },
});

import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSession } from "../state/SessionProvider";
import { colors } from "../theme";

export default function Review() {
  const { frames, retakeFrame } = useSession();

  return (
    <View style={styles.container}>
      <Text style={styles.subtitle}>{frames.length} frame{frames.length === 1 ? "" : "s"} captured. Tap a thumbnail to retake it.</Text>

      <FlatList
        data={frames.slice().sort((a, b) => a.sequence - b.sequence)}
        keyExtractor={(f) => f.frameId}
        numColumns={3}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <Pressable style={styles.cell} onPress={() => retakeFrame(item.frameId)}>
            <Image source={{ uri: item.localUri }} style={styles.thumb} contentFit="cover" />
            <Text style={styles.retakeLabel}>Retake</Text>
          </Pressable>
        )}
      />

      <View style={styles.footer}>
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Back to Capture</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryButton, frames.length === 0 && styles.disabled]}
          disabled={frames.length === 0}
          onPress={() => router.push("/upload")}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
  subtitle: { color: colors.textMuted, fontSize: 14 },
  grid: { gap: 8 },
  row: { gap: 8 },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 10, overflow: "hidden", backgroundColor: colors.surface, marginBottom: 8 },
  thumb: { width: "100%", height: "100%" },
  retakeLabel: {
    position: "absolute",
    bottom: 4,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  footer: { flexDirection: "row", gap: 12, paddingTop: 8 },
  secondaryButton: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  primaryButton: { flex: 1, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: colors.primaryText, fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.4 },
});

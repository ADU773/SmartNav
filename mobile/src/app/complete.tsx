import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSession } from "../state/SessionProvider";
import { useServer } from "../state/ServerProvider";
import { colors } from "../theme";

export default function Complete() {
  const { reset } = useSession();
  const { setSessionApiBase } = useServer();

  const startNew = () => {
    reset();
    // The QR-supplied address belongs to the finished session only.
    setSessionApiBase(null);
    router.replace("/");
  };

  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>✓</Text>
      </View>
      <Text style={styles.title}>Capture complete</Text>
      <Text style={styles.body}>
        Your photos have been uploaded. Go back to your computer — the SmartNav desktop app will generate the
        panorama and add it as an asset.
      </Text>
      <Pressable style={styles.primaryButton} onPress={startNew}>
        <Text style={styles.primaryButtonText}>Start a New Session</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  badge: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.success, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 32, fontWeight: "700" },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  body: { color: colors.textMuted, fontSize: 15, textAlign: "center", lineHeight: 22 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32, marginTop: 8 },
  primaryButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
});

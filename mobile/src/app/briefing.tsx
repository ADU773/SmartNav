import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSession } from "../state/SessionProvider";
import { colors } from "../theme";

export default function Briefing() {
  const { config, plan } = useSession();

  if (!config) {
    router.replace("/");
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Capture briefing</Text>

      {/* The plan is not a fixed 12 shots: it follows the camera's field of
          view, so it is shown rather than assumed. */}
      <View style={styles.planCard}>
        <View style={styles.planRow}>
          <Text style={styles.planValue}>{plan.targetCount}</Text>
          <Text style={styles.planLabel}>shots</Text>
          <Text style={styles.planValue}>{plan.spacingDeg.toFixed(0)}°</Text>
          <Text style={styles.planLabel}>apart</Text>
          <Text style={styles.planValue}>{(plan.overlapFraction * 100).toFixed(0)}%</Text>
          <Text style={styles.planLabel}>overlap</Text>
        </View>
        <Text style={styles.planNote}>
          Planned for a {plan.hfovDeg.toFixed(0)}° lens. Adjusted automatically once the camera reports what it
          captures.
        </Text>
      </View>

      <View style={styles.list}>
        <Item
          text={`Hold the phone upright and turn slowly through a full circle — ${plan.targetCount} shots, one every ${plan.spacingDeg.toFixed(
            0,
          )}°.`}
        />
        <Item text="Keep the horizon level — avoid tilting up or down." />
        <Item text="Frame the shot inside the camera box; that is exactly what gets saved." />
        <Item text="Follow the on-screen target; the shutter fires automatically when aligned, or tap it yourself anytime." />
        <Item text="Photos upload in the background as you go — no need to wait." />
      </View>

      <Pressable style={styles.primaryButton} onPress={() => router.push("/capture")}>
        <Text style={styles.primaryButtonText}>Start Guided Capture</Text>
      </Pressable>
    </View>
  );
}

function Item({ text }: { text: string }) {
  return (
    <View style={styles.item}>
      <View style={styles.bullet} />
      <Text style={styles.itemText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: "center", gap: 20 },
  title: { fontSize: 24, fontWeight: "700", color: colors.text },
  planCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, gap: 8 },
  planRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
  planValue: { color: colors.primary, fontSize: 20, fontWeight: "700" },
  planLabel: { color: colors.textMuted, fontSize: 13, marginRight: 8 },
  planNote: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  list: { gap: 14 },
  item: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  bullet: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
  itemText: { flex: 1, color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  primaryButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
});

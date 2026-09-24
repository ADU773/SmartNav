import { ScrollView, View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { CaptureFrame } from "../state/types";
import { colors } from "../theme";

const STATUS_LABEL: Record<CaptureFrame["status"], string> = {
  pending: "…",
  uploading: "↑",
  uploaded: "✓",
  failed: "!",
};

const STATUS_COLOR: Record<CaptureFrame["status"], string> = {
  pending: colors.textMuted,
  uploading: colors.primary,
  uploaded: colors.success,
  failed: colors.danger,
};

interface Props {
  frames: CaptureFrame[];
  onRetake?: (frameId: string) => void;
}

export function ThumbnailStrip({ frames, onRetake }: Props) {
  if (frames.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.content}>
      {frames.map((frame) => (
        <Pressable key={frame.frameId} style={styles.thumbWrap} onPress={() => onRetake?.(frame.frameId)}>
          <Image source={{ uri: frame.localUri }} style={styles.thumb} contentFit="cover" />
          <View style={[styles.badge, { backgroundColor: STATUS_COLOR[frame.status] }]}>
            <Text style={styles.badgeText}>{STATUS_LABEL[frame.status]}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { maxHeight: 72 },
  content: { gap: 8, paddingHorizontal: 4 },
  thumbWrap: { width: 56, height: 56, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surface },
  thumb: { width: "100%", height: "100%" },
  badge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});

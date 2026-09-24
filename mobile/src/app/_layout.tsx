import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../state/SessionProvider";
import { ServerProvider } from "../state/ServerProvider";
import { colors } from "../theme";

export default function RootLayout() {
  return (
    <ServerProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: "SmartNav Capture" }} />
          <Stack.Screen name="scan" options={{ title: "Scan QR" }} />
          <Stack.Screen name="settings" options={{ title: "Server" }} />
          <Stack.Screen name="briefing" options={{ title: "Ready to Capture" }} />
          <Stack.Screen name="capture" options={{ title: "Guided Capture", headerShown: false }} />
          <Stack.Screen name="review" options={{ title: "Review Frames" }} />
          <Stack.Screen name="upload" options={{ title: "Uploading" }} />
          <Stack.Screen name="complete" options={{ title: "Done", headerBackVisible: false }} />
        </Stack>
      </SessionProvider>
    </ServerProvider>
  );
}

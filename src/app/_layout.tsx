import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        {/* Leaving goes through a confirm, so no swipe-back out of a live session. */}
        <Stack.Screen name="session" options={{ gestureEnabled: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="library" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="collection/[kind]/[id]" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

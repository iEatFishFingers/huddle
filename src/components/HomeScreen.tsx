import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NearbySession, useNearbySessions } from '../discovery';
import { HOST_PORT } from '../protocol';
import { sessionStore, useSessionStore } from '../session/store';
import { Icon } from '../ui/Icon';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '../ui/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { ScanningDot } from './ScanningDot';
import { SessionCard } from './SessionCard';
import { TextField } from './TextField';

type Props = {
  onHost: (sessionName: string) => void;
  onJoin: (host: string, port: number, sessionName: string) => void;
};

/** "1.2.3.4" or "1.2.3.4:8787" → { host, port }, else null. */
function parseAddress(text: string): { host: string; port: number } | null {
  const m = text.trim().match(/^([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : HOST_PORT;
  if (port <= 0 || port > 65535) return null;
  return { host: m[1], port };
}

export function HomeScreen({ onHost, onJoin }: Props) {
  const insets = useSafeAreaInsets();
  const displayName = useSessionStore((s) => s.displayName);
  const { sessions, scanning, error, rescan } = useNearbySessions();
  const [refreshing, setRefreshing] = useState(false);
  const [hostStep, setHostStep] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [showAddress, setShowAddress] = useState(false);
  const [address, setAddress] = useState('');

  const sorted = useMemo(() => [...sessions].sort((a, b) => b.rssi - a.rssi), [sessions]);
  const parsed = parseAddress(address);
  const name = displayName.trim() || 'Guest';

  const refresh = () => {
    setRefreshing(true);
    rescan();
    setTimeout(() => setRefreshing(false), 1200);
  };

  const openHostStep = () => {
    setSessionName(`${name}'s Huddle`);
    setHostStep(true);
  };

  const join = (s: NearbySession) => onJoin(s.host, s.port, s.sessionName);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xxl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.surfaceHigh} />
        }
      >
        <View style={styles.inner}>
          <View style={styles.brand}>
            <Text style={styles.title}>Huddle</Text>
            <Text style={styles.subtitle}>Listen together, in sync, on up to 4 phones.</Text>
          </View>

          <TextField
            label="Your name"
            value={displayName}
            onChangeText={(t) => sessionStore.setDisplayName(t)}
            placeholder="Guest"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={24}
            returnKeyType="done"
          />

          {/* Host */}
          {!hostStep ? (
            <Button label="Host a session" size="lg" onPress={openHostStep} icon={<Icon name="plus" size={16} color={colors.onAccent} />} />
          ) : (
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>Name your session</Text>
              <TextField
                value={sessionName}
                onChangeText={setSessionName}
                placeholder={`${name}'s Huddle`}
                autoFocus
                maxLength={32}
                returnKeyType="go"
                onSubmitEditing={() => onHost(sessionName.trim() || `${name}'s Huddle`)}
                accessibilityLabel="Session name"
              />
              <View style={styles.sheetActions}>
                <Button label="Cancel" variant="ghost" onPress={() => setHostStep(false)} style={styles.flex} />
                <Button label="Start" onPress={() => onHost(sessionName.trim() || `${name}'s Huddle`)} style={styles.flex} />
              </View>
            </View>
          )}

          {/* Nearby */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Nearby sessions</Text>
              <ScanningDot active={scanning} />
            </View>
            {error && <Banner text={error} />}
            {sorted.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No sessions nearby yet. Ask a friend to host, or host one yourself.</Text>
                <Text style={styles.emptyHint}>Pull down to scan again.</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {sorted.map((s) => (
                  <SessionCard key={s.id} session={s} onPress={() => join(s)} />
                ))}
              </View>
            )}
          </View>

          {/* Join by address */}
          <View style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showAddress }}
              onPress={() => setShowAddress((v) => !v)}
              style={styles.disclosure}
              hitSlop={4}
            >
              <Text style={styles.disclosureText}>Join with address instead</Text>
              <Icon name={showAddress ? 'up' : 'down'} size={14} color={colors.textMuted} />
            </Pressable>
            {showAddress && (
              <View style={styles.sheet}>
                <Text style={styles.hint}>Use this when Bluetooth isn&apos;t available. The host&apos;s screen shows the address.</Text>
                <View style={styles.addressRow}>
                  <View style={styles.flex}>
                    <TextField
                      value={address}
                      onChangeText={setAddress}
                      placeholder="192.168.1.20"
                      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'url'}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="go"
                      accessibilityLabel="Host address"
                      onSubmitEditing={() => parsed && onJoin(parsed.host, parsed.port, parsed.host)}
                    />
                  </View>
                  <Button label="Join" disabled={!parsed} onPress={() => parsed && onJoin(parsed.host, parsed.port, parsed.host)} />
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, flexGrow: 1 },
  inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.xl },
  brand: { gap: space.xs },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: colors.textDim, fontSize: 15 },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sheetActions: { flexDirection: 'row', gap: space.sm },
  section: { gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  list: { gap: space.sm },
  empty: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: space.xs,
  },
  emptyText: { color: colors.textDim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  emptyHint: { color: colors.textMuted, fontSize: 12 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, alignSelf: 'flex-start' },
  disclosureText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

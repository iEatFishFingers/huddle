import { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HOST_PORT, QueueAction } from '../protocol';
import type { ActiveSession } from '../session/store';
import { useAddSongs, useAdvertise, useHostAddress, useTicker } from '../ui/hooks';
import { Icon } from '../ui/Icon';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '../ui/theme';
import { useSession } from '../useSession';
import { MemberStack } from './Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { NowPlaying } from './NowPlaying';
import { ProgressBar } from './ProgressBar';
import { LibraryPicker } from './library/LibraryPicker';
import { HistoryRow, QueueRow } from './QueueRow';
import { Toast, useToastQueue } from './Toast';

type Props = {
  active: ActiveSession;
  /** This user's display name. */
  name: string;
  /** Called after the user confirmed leaving. The session disconnects when this screen unmounts. */
  onLeave: () => void;
};

function confirm(title: string, message: string, ok: string, onOk: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`) ?? true) onOk();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Stay', style: 'cancel' },
    { text: ok, style: 'destructive', onPress: onOk },
  ]);
}

export function SessionScreen({ active, name, onLeave }: Props) {
  const insets = useSafeAreaInsets();
  const isHost = active.role === 'host';
  const loopback = active.role === 'host' ? active.transport : null;

  // must run before useSession connects the transport
  const { address, error: serverError } = useHostAddress(loopback);
  const { client, error, loading, durationMs, addFiles } = useSession(active.transport, name);
  const { pick, addFromLibrary, progress, error: addError, dismissError } = useAddSongs(addFiles);
  const [pickerOpen, setPickerOpen] = useState(false);
  const toasts = useToastQueue();
  const [showHistory, setShowHistory] = useState(false);

  const { state, queue, history, members, you, ready, memberCount, connected } = client;
  const sessionName = client.sessionName || active.sessionName;
  const current = client.currentTrack() ?? null;
  const duration = durationMs || current?.durationMs || 0;
  useTicker(state.playing, 250);
  const positionMs = current ? Math.max(0, client.expectedPositionMs()) : 0;

  const { error: advertiseError } = useAdvertise(isHost, {
    sessionName,
    hostName: name,
    host: address?.host ?? null,
    port: address?.port || HOST_PORT,
    members: Math.max(1, members.length),
  });

  useEffect(() => {
    const off = client.onNotice(toasts.push);
    return () => {
      off();
    };
  }, [client, toasts.push]);

  // The connection ended for good (host ended the session, session full, host unreachable):
  // say why, then go back to the session list instead of showing "Connecting…" forever.
  useEffect(() => {
    if (active.role !== 'joiner') return;
    active.transport.onError?.((message) => {
      if (Platform.OS === 'web') {
        globalThis.alert?.(message);
        onLeave();
        return;
      }
      Alert.alert(message, undefined, [{ text: 'OK', onPress: onLeave }], { cancelable: false });
    });
  }, [active, onLeave]);

  const leave = useCallback(() => {
    confirm(
      isHost ? 'End this session?' : 'Leave this session?',
      isHost ? 'Everyone listening will be disconnected.' : 'You can join again from Nearby sessions.',
      isHost ? 'End' : 'Leave',
      onLeave,
    );
  }, [isHost, onLeave]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => sub.remove();
  }, [leave]);

  const queueAction = (a: QueueAction) => client.send({ type: 'queue', ...a });

  let status: string | null = null;
  if (current) {
    if (loading) status = 'Buffering…';
    else if (memberCount > 0 && ready < memberCount) status = `Waiting for everyone (${ready}/${memberCount} ready)`;
  }

  const addLabel = progress
    ? `Adding ${progress.count} song${progress.count === 1 ? '' : 's'}… ${Math.round(progress.fraction * 100)}%`
    : null;

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.headerInner}>
          <View style={styles.headerText}>
            <Text style={styles.sessionName} numberOfLines={1}>
              {sessionName}
            </Text>
            <Text style={styles.headerMeta} numberOfLines={1}>
              {!connected
                ? 'Connecting…'
                : `${members.length || 1} listening · ${members
                    .map((m) => (m.id === you ? 'you' : m.name) + (m.isHost ? ' (host)' : ''))
                    .join(', ')}`}
            </Text>
          </View>
          <MemberStack members={members} you={you} />
          <Button label={isHost ? 'End' : 'Leave'} variant="danger" onPress={leave} style={styles.leave} />
        </View>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl * 2 }]}
      >
        <View style={styles.inner}>
          {isHost && (
            <View style={styles.hostInfo}>
              {address ? (
                <Text style={styles.hostText}>
                  Friends can join from <Text style={styles.strong}>Nearby sessions</Text> or with{' '}
                  <Text style={styles.address} selectable>
                    {address.host}
                    {address.port && address.port !== HOST_PORT ? `:${address.port}` : ''}
                  </Text>
                </Text>
              ) : (
                !serverError && <Text style={styles.hostText}>Starting the session server…</Text>
              )}
              {serverError && <Banner text={serverError} tone="warn" />}
              {address && advertiseError && <Text style={styles.subtle}>Bluetooth: {advertiseError}</Text>}
            </View>
          )}

          {!connected && !isHost && <Banner text="Connecting to the host… Make sure you're on the same Wi-Fi." />}
          {error && <Banner text={error} tone="warn" />}

          <NowPlaying
            track={current}
            playing={state.playing}
            positionMs={positionMs}
            durationMs={duration}
            status={status}
            canPlay={!!current || queue.length > 0}
            canNext={queue.length > 0}
            onSeek={(ms) => client.send({ type: 'control', action: 'seek', positionMs: ms })}
            onPlayPause={() => client.send({ type: 'control', action: state.playing ? 'pause' : 'play' })}
            onPrevious={() => queueAction({ action: 'previous' })}
            onNext={() => queueAction({ action: 'next' })}
          />

          {addLabel && (
            <View style={styles.progress}>
              <Text style={styles.progressText}>{addLabel}</Text>
              <ProgressBar fraction={progress!.fraction} />
            </View>
          )}
          {addError && <Banner text={addError} tone="warn" onDismiss={dismissError} />}

          {/* Up next */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Up next</Text>
              <Button
                label="Add songs"
                variant="secondary"
                onPress={() => setPickerOpen(true)}
                busy={!!progress}
                icon={<Icon name="plus" size={14} />}
              />
            </View>

            {queue.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>The queue is empty</Text>
                <Text style={styles.emptyText}>Anyone in the session can add songs from their phone.</Text>
                <Button label="Add songs" onPress={() => setPickerOpen(true)} busy={!!progress} style={{ marginTop: space.sm }} />
              </View>
            ) : (
              <View>
                {queue.map((id, i) => {
                  const t = client.trackById(id);
                  return (
                    <QueueRow
                      key={`${i}-${id}`}
                      index={i}
                      title={t?.title ?? 'Unknown track'}
                      addedBy={t?.addedBy ?? 'someone'}
                      isFirst={i === 0}
                      isLast={i === queue.length - 1}
                      onPlay={() => queueAction({ action: 'playIndex', index: i })}
                      onMoveUp={() => queueAction({ action: 'move', from: i, to: i - 1 })}
                      onMoveDown={() => queueAction({ action: 'move', from: i, to: i + 1 })}
                      onRemove={() => queueAction({ action: 'remove', index: i })}
                    />
                  );
                })}
              </View>
            )}
          </View>

          {/* Played */}
          {history.length > 0 && (
            <View style={styles.section}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showHistory }}
                onPress={() => setShowHistory((v) => !v)}
                style={styles.disclosure}
              >
                <Text style={styles.disclosureText}>Played ({history.length})</Text>
                <Icon name={showHistory ? 'up' : 'down'} size={14} color={colors.textMuted} />
              </Pressable>
              {showHistory &&
                [...history].reverse().map((id, i) => {
                  const t = client.trackById(id);
                  return (
                    <HistoryRow
                      key={`${i}-${id}`}
                      title={t?.title ?? 'Unknown track'}
                      addedBy={t?.addedBy ?? 'someone'}
                      onRequeue={() => queueAction({ action: 'add', trackId: id })}
                    />
                  );
                })}
            </View>
          )}
        </View>
      </ScrollView>

      <LibraryPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onAdd={addFromLibrary} onPickFiles={pick} />
      <Toast toast={toasts.current} onHidden={toasts.shift} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  sessionName: { color: colors.text, fontSize: 20, fontWeight: '800' },
  headerMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  leave: { paddingHorizontal: space.md },
  content: { paddingHorizontal: space.lg, paddingTop: space.lg },
  inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.lg },
  hostInfo: { gap: space.sm },
  hostText: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  strong: { color: colors.text, fontWeight: '700' },
  address: { color: colors.accent, fontWeight: '700', fontVariant: ['tabular-nums'] },
  subtle: { color: colors.textMuted, fontSize: 12 },
  progress: { gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  progressText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  section: { gap: space.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  empty: {
    alignItems: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    gap: space.xs,
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, alignSelf: 'flex-start' },
  disclosureText: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
});

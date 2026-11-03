import { router } from 'expo-router';
import { HomeScreen } from '../components/HomeScreen';
import { sessionStore } from '../session/store';
import { LoopbackTransport } from '../transport/LoopbackTransport';
import { WebSocketTransport } from '../transport/WebSocketTransport';

export default function Home() {
  return (
    <HomeScreen
      onHost={(sessionName) => {
        sessionStore.start({ transport: new LoopbackTransport({ sessionName }), role: 'host', sessionName });
        // replace (not push): Home unmounts, which stops the Bluetooth scan while in a session
        router.replace('/session');
      }}
      onJoin={(host, port, sessionName) => {
        sessionStore.start({ transport: new WebSocketTransport(host, port), role: 'joiner', sessionName });
        router.replace('/session');
      }}
    />
  );
}

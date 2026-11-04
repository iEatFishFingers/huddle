import { router } from 'expo-router';
import { LibraryScreen } from '../components/library/LibraryScreen';

export default function LibraryRoute() {
  return (
    <LibraryScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      onOpen={(kind, id, name) => router.push({ pathname: '/collection/[kind]/[id]', params: { kind, id, name } })}
    />
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { CollectionScreen } from '../../../components/library/CollectionScreen';

export default function CollectionRoute() {
  const { kind, id, name } = useLocalSearchParams<{ kind: string; id: string; name?: string }>();
  return (
    <CollectionScreen
      kind={kind === 'playlist' ? 'playlist' : 'album'}
      id={id}
      name={name}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/library'))}
    />
  );
}

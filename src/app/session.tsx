import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { SessionScreen } from '../components/SessionScreen';
import { sessionStore } from '../session/store';

export default function SessionRoute() {
  // Snapshot once: this screen owns the session for its whole lifetime.
  const [active] = useState(() => sessionStore.get().active);
  const [name] = useState(() => sessionStore.effectiveName());

  useEffect(() => {
    if (!active) {
      router.replace('/');
      return;
    }
    // Leaving by any route (Leave button, OS back) ends the session; useSession disconnects on unmount.
    return () => sessionStore.clear(active.transport);
  }, [active]);

  if (!active) return null;
  return <SessionScreen active={active} name={name} onLeave={() => router.replace('/')} />;
}

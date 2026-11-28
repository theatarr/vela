import { isPlayableDownload } from '@vela/core';
// The signed-out page (/sign-in): the active document's auth route over the selected server's
// sign-in state, or Connect for a signed-out Plex server. Once signed in, home.
import { useVela as useSession, useVelaState } from '@vela/core/react';
import { SignedOut } from '@vela/skin/src/widgets/auth';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect } from 'react';
import { router } from '../../src/router';
import { Platform, View } from 'react-native';
import { useVela } from '../../src/vela';
import { safeReturnTo } from '../../src/return-to';
import { returnSearchQuery } from '../../src/search-address';

export default function SignIn() {
  const session = useSession();
  const auth = useVelaState(s => s.auth);
  const hasDownloads = useVelaState(s => s.downloads.items.some(isPlayableDownload));
  const servers = useVelaState(s => s.servers);
  const app = useVela();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = safeReturnTo(params.returnTo);
  useEffect(() => {
    if (Platform.OS !== 'web' || auth.phase !== 'signed-in') return;
    // Expo's route can settle before the browser's history entry carries the query.
    const query = returnSearchQuery(returnTo);
    if (query && session.getState().search.query !== query) session.search.setQuery(query);
  }, [auth.phase, returnTo, session]);
  if (auth.phase === 'signed-in') return <Redirect href={returnTo as Href} />;
  const host = app.host('auth', 'auth');
  const route = app.doc?.routes.auth;
  if (!host || !route) return <View style={{ flex: 1 }} />;
  return (
    <SignedOut
      host={host}
      route={route}
      auth={auth}
      actions={session.auth}
      servers={servers}
      serverActions={session.servers}
      art={app.authArt}
      onDownloads={hasDownloads ? () => router.push('/downloads') : undefined}
    />
  );
}

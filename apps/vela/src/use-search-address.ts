// Keeps the web address and the open search query in step without navigating (search-address.ts):
// the query goes into the current history entry once typing pauses, an address that carries one
// opens it on load, and Back or Forward onto an entry reopens the query that entry carried.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { Vela as Store } from '@vela/core';
import { SEARCH_ADDRESS_DELAY_MS, addressQuery, searchAddress } from './search-address';

const base = () => process.env.EXPO_BASE_URL ?? '';

export function useSearchAddress(store: Store, query: string, pathname: string, signedIn: boolean): void {
  const web = Platform.OS === 'web' && typeof window !== 'undefined';
  // Until the address's own query is read, an empty store query must not erase it.
  const adopted = useRef(false);

  useEffect(() => {
    if (!web || !signedIn || adopted.current) return;
    const carried = addressQuery(window.location, base());
    // Sign-in settles before the router restores returnTo. Wait for a search address
    // before allowing the store to write back to history.
    if (carried === undefined) return;
    adopted.current = true;
    if (carried && store.getState().search.query !== carried) store.search.setQuery(carried);
  }, [web, signedIn, store, pathname]);

  useEffect(() => {
    if (!web || !signedIn) return;
    const restore = () => {
      const carried = addressQuery(window.location, base());
      if (carried !== undefined && store.getState().search.query !== carried) store.search.setQuery(carried);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [web, signedIn, store]);

  useEffect(() => {
    if (!web || !signedIn || !adopted.current || (pathname !== '/' && pathname !== '/search')) return;
    const timer = setTimeout(() => {
      // The router's own entry state (its id) stays; only the address changes.
      const next = searchAddress(window.location, store.getState().search.query, base());
      if (next) window.history.replaceState(window.history.state, '', next);
    }, SEARCH_ADDRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [web, signedIn, store, query, pathname]);
}

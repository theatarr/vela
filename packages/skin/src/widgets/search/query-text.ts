// The text in a search field, held by the field itself and reported to the store, rather than
// read back from the store's query on every keystroke. A field controlled by env.query drops
// characters typed in a burst (a paste, voice input, a fast typist on Android TV): the first one
// opens search, the page re-renders, and the later ones reach an input whose value prop still
// holds the first, which resets them. The field follows the store only when the query changes
// from elsewhere (cleared, or set by another field).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useHost } from '../../host';

const WEB_QUERY_DELAY_MS = 100;

export function useQueryText(): { text: string; change(text: string): void } {
  const host = useHost();
  const query = host.env.query;
  const [text, setText] = useState(query);
  // What this field has sent and the store has not echoed yet, oldest first. The store may echo
  // a burst late and one value at a time; any of them is this field's own, not a change.
  const pending = useRef<string[]>([]);
  const publish = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The web's held-back update, if any: sent when the pause ends, or at once if the field goes
  // away first, so the last characters typed before leaving search still reach the store.
  const held = useRef<(() => void) | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(publish.current);
    const send = held.current;
    held.current = undefined;
    send?.();
  }, []);

  useEffect(() => flush, [flush]);

  useEffect(() => {
    const echoed = pending.current.indexOf(query);
    if (echoed >= 0) {
      pending.current = pending.current.slice(echoed + 1);
      return;
    }
    pending.current = [];
    clearTimeout(publish.current);
    held.current = undefined;
    setText(query);
  }, [query]);

  const { setQuery } = host;
  const change = useCallback(
    (next: string) => {
      setText(next);
      const send = () => {
        pending.current.push(next);
        setQuery(next);
      };
      // A store update redraws the search route and shell. Give the web input a
      // chance to commit a burst of native input events before that work starts.
      if (Platform.OS === 'web') {
        clearTimeout(publish.current);
        held.current = send;
        publish.current = setTimeout(flush, WEB_QUERY_DELAY_MS);
      } else send();
    },
    [setQuery, flush],
  );
  return { text, change };
}

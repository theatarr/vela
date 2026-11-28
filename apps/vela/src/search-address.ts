// The web address reflects the open search query, as `/?q=` on home or the shareable
// `/search?q=`, so a reload or a shared link reopens it. Typing only rewrites the current history
// entry: a route change per keystroke remounted home's screen and took the caret out of the field.

/** How long the address waits for typing to pause before it is rewritten. */
export const SEARCH_ADDRESS_DELAY_MS = 300;

interface Address {
  pathname: string;
  search: string;
  hash?: string;
}

/** The app path below the export base (`/vela/search` → `/search`), or undefined outside it. */
function appPath(pathname: string, base: string): string | undefined {
  const root = base.replace(/\/+$/, '');
  if (!root) return pathname || '/';
  if (pathname === root) return '/';
  return pathname.startsWith(`${root}/`) ? pathname.slice(root.length) : undefined;
}

/** Whether search draws at this address: home, or the shareable search route. */
export function isSearchPlace(pathname: string, base = ''): boolean {
  const path = appPath(pathname, base);
  return path === '/' || path === '/search' || path === '/search/';
}

/** The query the address carries: '' at a search place without one, undefined elsewhere. */
export function addressQuery(address: Address, base = ''): string | undefined {
  if (!isSearchPlace(address.pathname, base)) return undefined;
  return new URLSearchParams(address.search).get('q') ?? '';
}

/** A sign-in return target is already app-relative and may arrive before history updates. */
export function returnSearchQuery(href: string): string {
  const target = href.split('#', 1)[0] ?? '';
  const separator = target.indexOf('?');
  if (separator < 0) return '';
  return addressQuery({ pathname: target.slice(0, separator), search: target.slice(separator) }) ?? '';
}

/** The address that carries `query` in place of the current one (other parameters and the hash
 * kept), or undefined when the address already carries it or search does not draw here. */
export function searchAddress(address: Address, query: string, base = ''): string | undefined {
  const current = addressQuery(address, base);
  if (current === undefined || current === query) return undefined;
  const params = new URLSearchParams(address.search);
  if (query) params.set('q', query);
  else params.delete('q');
  const search = params.toString();
  return `${address.pathname}${search ? `?${search}` : ''}${address.hash ?? ''}`;
}

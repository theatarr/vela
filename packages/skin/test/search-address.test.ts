import { describe, expect, test } from 'bun:test';
import { addressQuery, isSearchPlace, returnSearchQuery, searchAddress } from '../../../apps/vela/src/search-address';

test('the auth return route carries search before browser history reflects it', () => {
  expect(returnSearchQuery('/?q=the+office#top')).toBe('the office');
  expect(returnSearchQuery('/search?q=one%3Ftwo')).toBe('one?two');
  expect(returnSearchQuery('/title/1?q=rain')).toBe('');
  expect(returnSearchQuery('/#top?q=rain')).toBe('');
});

const at = (path: string) => {
  const url = new URL(path, 'https://vela.example');
  return { pathname: url.pathname, search: url.search, hash: url.hash };
};

describe('search address', () => {
  test('search draws on home and the shareable search route, below the export base', () => {
    expect(isSearchPlace('/')).toBe(true);
    expect(isSearchPlace('/search')).toBe(true);
    expect(isSearchPlace('/title/1')).toBe(false);
    expect(isSearchPlace('/vela', '/vela')).toBe(true);
    expect(isSearchPlace('/vela/', '/vela/')).toBe(true);
    expect(isSearchPlace('/vela/search', '/vela')).toBe(true);
    expect(isSearchPlace('/search', '/vela')).toBe(false);
    expect(isSearchPlace('/velalibrary', '/vela')).toBe(false);
  });

  test('a link or reload reads its query from home or the search route only', () => {
    expect(addressQuery(at('/?q=the+office'))).toBe('the office');
    expect(addressQuery(at('/search?q=the%20office'))).toBe('the office');
    expect(addressQuery(at('/vela/?q=rain'), '/vela')).toBe('rain');
    expect(addressQuery(at('/'))).toBe('');
    expect(addressQuery(at('/title/1?q=rain'))).toBeUndefined();
  });

  test('typing rewrites only the query, keeping the path, other parameters and the hash', () => {
    expect(searchAddress(at('/'), 'the office')).toBe('/?q=the+office');
    expect(searchAddress(at('/?skin=mochi#top'), 'rain')).toBe('/?skin=mochi&q=rain#top');
    expect(searchAddress(at('/search?q=the'), 'the office')).toBe('/search?q=the+office');
    expect(searchAddress(at('/vela/?q=a'), 'ab', '/vela')).toBe('/vela/?q=ab');
  });

  test('clearing drops the query; an address that already says it is left alone', () => {
    expect(searchAddress(at('/?skin=mochi&q=rain'), '')).toBe('/?skin=mochi');
    expect(searchAddress(at('/search?q=rain'), '')).toBe('/search');
    expect(searchAddress(at('/?q=the+office'), 'the office')).toBeUndefined();
    expect(searchAddress(at('/'), '')).toBeUndefined();
  });

  test('an address search does not draw on is never rewritten', () => {
    expect(searchAddress(at('/title/1'), 'rain')).toBeUndefined();
    expect(searchAddress(at('/library/films?view=library'), 'rain')).toBeUndefined();
  });
});

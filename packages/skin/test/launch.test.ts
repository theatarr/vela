import { expect, test } from 'bun:test';
import { launchReady, launchDelay, fontLoadRevision, searchlightGeometry } from '../../../apps/vela/src/launch-state';

test('launch waits for the first rendered answer, including failures and signed-out routing', () => {
  expect(launchReady('offline', 'idle', true, true, false)).toBe(true);
  expect(launchReady('offline', 'idle', true, false, false)).toBe(false);
  expect(launchReady('starting', 'idle', true, false, false)).toBe(false);
  expect(launchReady('signed-in', 'loading', true, false, false)).toBe(false);
  expect(launchReady('signed-in', 'loading', true, false, false, true)).toBe(true);
  expect(launchReady('signed-in', 'ready', false, false, false)).toBe(false);
  expect(launchReady('signed-in', 'ready', true, false, false)).toBe(true);
  expect(launchReady('signed-in', 'failed', true, false, false)).toBe(true);
  expect(launchReady('signed-out', 'idle', true, false, false)).toBe(false);
  expect(launchReady('signed-out', 'idle', true, true, false)).toBe(true);
  expect(launchReady('starting', 'idle', true, false, true)).toBe(true);
});
test('the full lock and final bulb finish before hand-off, even on a fast response', () => {
  expect(launchDelay(0, false)).toBe(2520);
  expect(launchDelay(1930, false)).toBe(590);
  expect(launchDelay(2500, false)).toBe(20);
  expect(launchDelay(6000, false)).toBe(0);
  expect(launchDelay(0, true)).toBe(0);
});
test('a signed-in search can draw while the unrelated home feed is pending', () => {
  expect(launchReady('signed-in', 'loading', true, false, false, false, true)).toBe(true);
  expect(launchReady('starting', 'loading', true, false, false, false, true)).toBe(false);
  expect(launchReady('signed-in', 'loading', false, false, false, false, true)).toBe(false);
});
test('searchlight viewport and wordmark keep the approved phone and TV proportions', () => {
  const phone = searchlightGeometry(390, 844);
  expect(phone.markWidth).toBeCloseTo(163.8);
  expect(phone.markHeight).toBeCloseTo(103.74);
  expect(phone.wordWidth).toBeCloseTo(63.96);
  expect(searchlightGeometry(1920, 1080)).toEqual(searchlightGeometry(3840, 2160));
  expect(searchlightGeometry(1920, 1080).markWidth).toBe(300);
});

test('the first font load gates launch and later loads preserve route readiness', () => {
  const launchWithFonts = (revision: number) => launchReady('signed-out', 'idle', revision > 0, true, false);
  const initial = fontLoadRevision(0, 'loading');
  expect(launchWithFonts(initial)).toBe(false);
  const first = fontLoadRevision(initial, 'settled');
  expect(launchWithFonts(first)).toBe(true);
  const reloading = fontLoadRevision(first, 'loading');
  expect(reloading).toBe(first);
  expect(launchWithFonts(reloading)).toBe(true);
  expect(fontLoadRevision(reloading, 'settled')).toBe(first + 1);
});

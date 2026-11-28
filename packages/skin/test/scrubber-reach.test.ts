// The offsets of the timeline's touch target from its drawn 22-point row: 10 above and 12 below
// on phones and touch screens, none with a mouse or on a TV.
import { expect, test } from 'bun:test';
import { scrubberReach } from '../src/widgets/player/present';

const ROW = 22;

function bounds(tv: boolean, handheld: boolean) {
  const { above, below } = scrubberReach(tv, handheld);
  return { top: 0 - above, bottom: ROW + below };
}

test('handheld offsets are 10 points above and 12 below the row, 44 in all', () => {
  expect(bounds(false, true)).toEqual({ top: -10, bottom: 34 });
});

test('desktop offsets are zero', () => {
  expect(bounds(false, false)).toEqual({ top: 0, bottom: ROW });
});

test('TV offsets are zero, also on Android TV where the geometry reads as handheld', () => {
  expect(bounds(true, false)).toEqual({ top: 0, bottom: ROW });
  expect(bounds(true, true)).toEqual({ top: 0, bottom: ROW });
});

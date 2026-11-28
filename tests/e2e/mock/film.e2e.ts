import { expect, type Locator } from 'e2e';
import { describe, test, type Browser } from '@e2e-dev/web';
import { runningBrowserPage } from '../muted-browser';
import { videoState, waitForVideoPlayback, waitForVideoReady } from './player-ready';

async function seekFraction(scrubber: Locator, fraction: number) {
  const box = await scrubber.boundingBox();
  expect(box).not.toBeNull();
  await scrubber.tap({ position: { x: Math.max(1, box!.width * fraction), y: Math.max(1, box!.height / 2) } });
}

async function admin(browser: Browser, path: string, body: Record<string, string | number | boolean>) {
  return browser.evaluate(async ({ path, body }) => (await fetch('/__admin/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).status, { path, body });
}

async function position(scrubber: Locator) {
  return Number(await scrubber.getAttribute('aria-valuenow'));
}

async function originalLostRemaining(browser: Browser) {
  return browser.evaluate(async () => ((await (await fetch('/__admin/faults')).json()) as { originalLost409: number }).originalLost409);
}

describe('Film deterministic release gate', { session: 'mock-film' }, () => {
  test('versions report the release actually playing after failover', async ({ app, browser, screen }) => {
    await app.open('/vela/title/title-1-1');
    await expect(screen.getByRole('heading', 'The Last Observatory')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', /^Versions,/).tap();
    await expect(screen.getByTestId('versions-sheet')).toBeVisible();
    await expect(screen.getByText('Your choice')).toBeVisible();
    await expect(screen.getByRole('radio', /4K HDR10 Blu-ray/)).toBeEnabled();
    await expect(screen.getByRole('radio', /Director’s Cut/)).toBeDisabled();
    await screen.getByRole('radio', /4K Dolby Vision Remux/).tap();

    await waitForVideoReady(browser, screen);
    expect(await browser.evaluate(async () => (await fetch('/__admin/failover', { method: 'POST' })).status)).toBe(200);
    await screen.getByTestId('player-quality-button').tap();
    await expect(screen.getByRole('radio', /1080p WEB-DL · DD\+ 5\.1.*Playing now/)).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('player-quality-button').tap();
    await screen.getByRole('button', 'Close player').tap();
  });

  test('intro, credits, and final credits expose the right actions', async ({ app, screen }) => {
    await app.open('/vela/watch/episode-1-3');
    await expect(screen.getByText('S1 · E3 · Pressure Drop')).toBeVisible({ timeout: 30_000 });
    const scrubber = screen.getByTestId('player-scrub');
    await expect(scrubber).toBeEnabled({ timeout: 30_000 });
    await expect(screen.getByRole('progressbar', 'Preparing your screening')).toBeHidden({ timeout: 30_000 });

    await seekFraction(scrubber, 10 / 180);
    await expect(screen.getByTestId('player-skip-intro')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('player-skip-intro').tap();
    await seekFraction(scrubber, 30 / 180);
    await expect(screen.getByTestId('player-skip-intro')).toBeHidden();

    await seekFraction(scrubber, 145 / 180);
    await expect(screen.getByTestId('player-skip-credits')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('player-skip-credits').tap();
    await seekFraction(scrubber, 160 / 180);
    await expect(screen.getByTestId('player-skip-credits')).toBeHidden();

    await seekFraction(scrubber, 170 / 180);
    await expect(screen.getByTestId('player-skip-next')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('player-skip-next').tap();
    await expect(screen.getByText('S1 · E4 · A Distant Light')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Close player').tap();
  });

  test('a lost original reopens the replacement at the held position and names its release', async ({ app, browser, screen }) => {
    await app.open('/vela/title/title-1-1');
    expect(await admin(browser, 'sidecar', { enabled: true, pathId: 'direct' })).toBe(200);
    try {
      // Leave later parts of the original unbuffered so the seek requests a new byte range.
      expect(await admin(browser, 'faults', { bandwidthBps: 3_000_000 })).toBe(200);
      await expect(screen.getByRole('heading', 'The Last Observatory')).toBeVisible({ timeout: 30_000 });
      await screen.getByRole('button', /^Versions,/).tap();
      await screen.getByRole('radio', /4K Dolby Vision Remux/).tap();
      await expect(screen.getByRole('button', 'Close player')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('progressbar', 'Preparing your screening')).toBeHidden({ timeout: 30_000 });
      const scrubber = screen.getByTestId('player-scrub');
      await expect(scrubber).toBeEnabled({ timeout: 30_000 });
      await seekFraction(scrubber, 0.35);
      await expect.poll(() => position(scrubber), { timeout: 10_000 }).toBeGreaterThan(55);

      expect(await admin(browser, 'faults', { originalLost409: 1, originalLostVersionUnavailable: false })).toBe(200);
      await seekFraction(scrubber, 0.55);
      await screen.getByTestId('player-quality-button').tap();
      await expect(screen.getByRole('radio', /1080p WEB-DL · DD\+ 5\.1.*Playing now/)).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => position(scrubber), { timeout: 10_000 }).toBeGreaterThan(90);
      await screen.getByTestId('player-quality-button').tap();
      await screen.getByRole('button', 'Close player').tap();
    } finally {
      await admin(browser, 'faults', { bandwidthBps: 0, originalLost409: 0, originalLostTruncate: 0, originalLostVersionUnavailable: false });
      await admin(browser, 'sidecar', { enabled: false });
    }
  });

  test('a pinned lost original opens the version picker without losing position', async ({ app, browser, screen }) => {
    await app.open('/vela/title/title-1-2');
    expect(await admin(browser, 'sidecar', { enabled: true, pathId: 'direct' })).toBe(200);
    try {
      expect(await admin(browser, 'faults', { bandwidthBps: 3_000_000 })).toBe(200);
      await expect(screen.getByRole('button', /^Versions,/)).toBeVisible({ timeout: 30_000 });
      await screen.getByRole('button', /^Versions,/).tap();
      await screen.getByRole('radio', /4K Dolby Vision Remux/).tap();
      await expect(screen.getByRole('progressbar', 'Preparing your screening')).toBeHidden({ timeout: 30_000 });
      const scrubber = screen.getByTestId('player-scrub');
      await expect(scrubber).toBeEnabled({ timeout: 30_000 });
      await seekFraction(scrubber, 0.35);
      await expect.poll(() => position(scrubber), { timeout: 10_000 }).toBeGreaterThan(55);
      await screen.getByTestId('player-toggle').tap();
      await expect(screen.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Play');

      expect(await admin(browser, 'faults', { originalLost409: 1, originalLostVersionUnavailable: true })).toBe(200);
      await seekFraction(scrubber, 0.9);
      await expect.poll(() => originalLostRemaining(browser), { timeout: 60_000 }).toBe(0);
      await expect(screen.getByRole('radio', /4K Dolby Vision Remux.*Playing now/)).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => position(scrubber), { timeout: 10_000 }).toBeGreaterThan(155);
      await screen.getByTestId('player-quality-button').tap();
      await screen.getByRole('button', 'Close player').tap();
    } finally {
      await admin(browser, 'faults', { bandwidthBps: 0, originalLost409: 0, originalLostTruncate: 0, originalLostVersionUnavailable: false });
      await admin(browser, 'sidecar', { enabled: false });
    }
  });
  test('a title Ether is still preparing waits in the server\'s words past five attempts, then plays', async ({ app, browser, screen }) => {
    await app.open('/vela/title/title-1-1');
    await expect(screen.getByRole('heading', 'The Last Observatory')).toBeVisible({ timeout: 30_000 });
    // Seven `preparing` answers a second apart: six download-queue positions, then finding a source.
    expect(await admin(browser, 'faults', { videoStartPreparing: 7 })).toBe(200);
    try {
      await app.open('/vela/watch/title-1-1?positionSeconds=0');
      await expect(screen.getByTestId('player-preparing')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByTestId('player-preparing')).toHaveText(/queued at TorBox behind \d active downloads/);
      await expect(screen.getByText('Finding a source…')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByTestId('player-retrying')).toBeHidden();
      await waitForVideoReady(browser, screen);
      await expect(screen.getByTestId('player-preparing')).toBeHidden();
      expect(await browser.evaluate(async () => ((await (await fetch('/__admin/faults')).json()) as { videoStartPreparing: number }).videoStartPreparing)).toBe(0);
      await screen.getByRole('button', 'Close player').tap();
    } finally {
      await admin(browser, 'faults', { videoStartPreparing: 0 });
    }
  });

  test('with a coarse pointer, mouse clicks just inside the top and bottom edges of the taller timeline target seek the film', async ({ app, browser, screen }) => {
    await app.open('/vela/title/title-1-1');
    await expect(screen.getByRole('heading', 'The Last Observatory')).toBeVisible({ timeout: 30_000 });
    const page = runningBrowserPage(new URL(await browser.url()).origin);
    // The browser reports a coarse pointer (a phone or tablet) while the flag is set.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('vela-e2e-coarse') !== '1') return;
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const list = matchMedia(query);
        if (/\(pointer:\s*coarse\)/.test(query)) Object.defineProperty(list, 'matches', { value: true });
        return list;
      };
    });
    await page.evaluate(() => sessionStorage.setItem('vela-e2e-coarse', '1'));
    try {
      await app.open('/vela/watch/title-1-1?positionSeconds=0');
      expect(await browser.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
      await waitForVideoPlayback(browser, screen);
      // Paused, the controls stay up.
      await screen.getByTestId('player-toggle').tap();
      await expect(screen.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Play');
      const scrubber = screen.getByTestId('player-scrub');
      const duration = Number(await scrubber.getAttribute('aria-valuemax'));
      expect(duration).toBeGreaterThan(60);
      // The drawn row is 22 points; the target reaches 10 above it and 12 below. Click 1 point inside each edge.
      const edges = [
        { fraction: 0.3, y: (box: { y: number; height: number }) => box.y - 10 + 1 },
        { fraction: 0.7, y: (box: { y: number; height: number }) => box.y + box.height + 12 - 1 },
      ];
      for (const edge of edges) {
        const box = await scrubber.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBe(22);
        await page.mouse.click(box!.x + box!.width * edge.fraction, edge.y(box!));
        // The slider shows the target at once; wait for the video itself to settle there.
        await expect.poll(async () => {
          const video = await videoState(browser);
          return !video.seeking && Math.abs(video.position - duration * edge.fraction) < 3;
        }, { timeout: 10_000 }).toBe(true);
      }
      await screen.getByRole('button', 'Close player').tap();
    } finally {
      await page.evaluate(() => sessionStorage.removeItem('vela-e2e-coarse'));
    }
  });
});

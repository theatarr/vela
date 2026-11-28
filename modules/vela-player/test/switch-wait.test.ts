import { afterAll, afterEach, expect, test } from 'bun:test';
import { createHostContext } from '../web/engine/host/context';
import { requestSwitch } from '../web/engine/host/authorizations';
import { checkWaiting } from '../web/engine/host/watchdog';
import { recoverPlayback } from '../web/engine/host/recovery';
import { PLAYING_SWITCH_DEADLINE_MS, SWITCH_DEADLINE_MS, switchWait } from '../web/engine/host/switch-wait';
import type { HostContext } from '../web/engine/host/state';
import type { EngineEvent, PlaybackSession, Source } from '../web/engine/model';

test('a switch the media plays on through waits past the short deadline, then is dropped', () => {
  expect(switchWait(SWITCH_DEADLINE_MS + 2000, true)).toBe('wait');
  expect(switchWait(PLAYING_SWITCH_DEADLINE_MS + 1, true)).toBe('drop');
});

test('a switch with nothing playing behind it fails at the short deadline', () => {
  expect(switchWait(SWITCH_DEADLINE_MS - 1, false)).toBe('wait');
  expect(switchWait(SWITCH_DEADLINE_MS + 1, false)).toBe('fail');
});

/** Just enough of a <video> for the host's bookkeeping: it plays the original file. */
function video() {
  const attributes = new Map<string, string>([['src', 'https://plex.example/library/parts/1/file.mp4']]);
  return {
    currentTime: 50, duration: 6555, videoWidth: 0, videoHeight: 0, readyState: 4, paused: false, error: null, playbackRate: 1, volume: 1, muted: false,
    hasAttribute: (name: string) => attributes.has(name),
    removeAttribute: (name: string) => void attributes.delete(name),
    pause() { this.paused = true; },
    load() {},
    canPlayType: () => '',
    addEventListener() {},
    removeEventListener() {},
    buffered: { length: 0 },
  };
}

const original: Source = { id: 'original', strategy: 'direct', delivery: 'file', url: 'https://plex.example/library/parts/1/file.mp4',
  mime: 'video/mp4', edition: '', timeline: '1', original: true, renditions: [] } as unknown as Source;
const session = { id: 'vela-1', serverState: 'playing', serverControlled: true, selectedSourceId: 'original', mediaId: '1', edition: '',
  position: 0, duration: 6555, live: false, sourceGeneration: 0, seekGeneration: 0, audioTracks: [], subtitleTracks: [], chapters: [],
  sources: [original], onDemandSources: [{ id: 'plex-hls', onDemand: true, delivery: 'hls', mime: 'application/vnd.apple.mpegurl' }] } as unknown as PlaybackSession;

let context: HostContext | undefined;
// A failed playback publishes a snapshot, which asks the page what it offers (fullscreen,
// picture-in-picture, the original-file route): a plain-http page offering none of them.
const page = globalThis as Record<string, unknown>;
const added = Object.entries({ document: { fullscreenEnabled: false, pictureInPictureEnabled: false }, isSecureContext: false })
  .filter(([name]) => !(name in page)).map(([name, value]) => { page[name] = value; return name; });
afterEach(() => { if (context?.lifecycle.timer) clearInterval(context.lifecycle.timer); context = undefined; });
afterAll(() => { for (const name of added) delete page[name]; });

/** The original playing at 50 s, and the viewer's switch to the Plex server stream asked of the server. */
function switching(events: EngineEvent[]): HostContext {
  const v = video();
  context = createHostContext(v as never, event => events.push(event), v as never, false, undefined, {} as never);
  clearInterval(context.lifecycle.timer);
  context.lifecycle.timer = undefined;
  context.session.controller.start(session.id, 0, 0);
  context.session.current = session;
  context.media.source = original;
  context.media.backend = 'file';
  context.playback.status = 'playing';
  context.playback.wantsPlay = true;
  context.watchdog.everPlayed = true;
  requestSwitch(context, { id: 'plex-hls', onDemand: true }, 50);
  return context;
}

// The Plex decision for the server stream took 17 s (0.2.70 lab gate). The engine used to give up
// at 15 s and fail the playback, so the session was restarted and the decided stream never asked for.
test('a slow server decision does not fail the original that plays on meanwhile', () => {
  const events: EngineEvent[] = [];
  const host = switching(events);
  expect(events.filter(e => e.type === 'session-command')).toHaveLength(1);
  host.session.pendingSwitch!.startedAt = performance.now() - 17_000;
  checkWaiting(host);
  expect(events.filter(e => e.type === 'error')).toEqual([]);
  expect(host.playback.status).toBe('playing');
  expect(host.playback.failure).toBeNull();
  // Still pending: the late answer is handed off at the position then playing.
  expect(host.session.pendingSwitch?.sourceId).toBe('plex-hls');
});

test('a server that never answers costs the switch, not the playback', () => {
  const events: EngineEvent[] = [];
  const host = switching(events);
  host.session.pendingSwitch!.startedAt = performance.now() - PLAYING_SWITCH_DEADLINE_MS - 1000;
  checkWaiting(host);
  const errors = events.flatMap(e => e.type === 'error' ? [e.failure] : []);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.kind).toBe('action');
  expect(host.session.pendingSwitch).toBeUndefined();
  expect(host.playback.status).toBe('playing');
  // An answer that still comes is handed off where the media then is, not where it was asked.
  expect(host.session.droppedSwitch?.sourceId).toBe('plex-hls');
});

test('a switch that released its media still fails at the short deadline', () => {
  const events: EngineEvent[] = [];
  const host = switching(events);
  // A recovery switch: the media was released before the server was asked.
  host.surface.video.removeAttribute('src');
  host.playback.status = 'recovering';
  host.session.pendingSwitch!.startedAt = performance.now() - SWITCH_DEADLINE_MS - 1000;
  checkWaiting(host);
  const errors = events.flatMap(e => e.type === 'error' ? [e.failure] : []);
  expect(errors.map(f => f.kind)).toEqual(['network']);
  expect(host.playback.status as string).toBe('failed');
});

test('a direct-play startup with no progress asks the broker for its transcode at the resume position', async () => {
  const events: EngineEvent[] = [];
  const host = switching(events);
  events.length = 0;
  host.session.pendingSwitch = undefined;
  host.surface.video.removeAttribute('src');
  Object.assign(host.surface.video, { readyState: 0 });
  host.session.current = { ...session, startupFallbackSources: session.onDemandSources };
  host.playback.resumePosition = 50;
  host.playback.status = 'loading';
  host.watchdog.everPlayed = false;
  await recoverPlayback(host, new Error('Core startup made no byte, packet or PCM progress for 8 seconds'), host.session.controller.token());
  expect(events.filter(e => e.type === 'error')).toEqual([]);
  expect(events.filter(e => e.type === 'session-command')).toEqual([expect.objectContaining({
    command: expect.objectContaining({ kind: 'switch', pathId: 'plex-hls', atSeconds: 50, sourceGeneration: 0, seekGeneration: 0 }),
  })]);
  expect(host.session.pendingSwitch).toMatchObject({ recovery: true });
});

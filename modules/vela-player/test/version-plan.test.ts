import { expect, test } from 'bun:test';
import type { PlaybackPath, PlaybackPlan } from '../../../packages/protocol/types';
import type { Snapshot } from '../web/engine/model';
import { observation, sessionFromPlan } from '../web/engine/protocol';

test('a version plan carries its selected transport and external subtitle into the web session', () => {
  const plan = {
    sessionId: 's', revision: 2, state: 'ready', positionSeconds: 20, sourceGeneration: 2, seekGeneration: 2,
    selectedVersionId: 'edition-b', selectedPathId: 'primary', selectedSubtitleTrackId: 'sub-b',
    paths: [{ id: 'primary', kind: 'remux', transport: 'hls', url: '/new/index.m3u8',
      mimeType: 'application/vnd.apple.mpegurl', readiness: 'ready', qualities: [], boundaries: [] }],
    audioTracks: [], chapters: [], fallback: { state: 'unsupported' },
    subtitleTracks: [{ id: 'sub-b', kind: 'subtitle', name: 'English', language: 'en', codec: 'webvtt',
      delivery: { kind: 'external', format: 'webvtt', url: '/new/english.vtt' } }],
  } satisfies PlaybackPlan;
  const session = sessionFromPlan(plan, 'https://ether.test/vela/');
  expect(session.selectedVersionId).toBe('edition-b');
  expect(session.sources.find(source => source.id === session.selectedSourceId))
    .toMatchObject({ delivery: 'hls', url: 'https://ether.test/new/index.m3u8' });
  expect(session.subtitleTrackId).toBe('sub-b');
  expect(session.subtitleTracks[0]?.delivery).toEqual({
    kind: 'external', format: 'webvtt', url: 'https://ether.test/new/english.vtt',
  });
});

test('a sidecar opening after a source change does not report subtitles Off', () => {
  const snapshot = {
    sessionId: 's', sourceId: 'primary', sourceGeneration: 2, seekGeneration: 2,
    position: 20, state: 'playing', playable: [], subtitleTrackId: null, pendingSubtitleTrackId: 'sub-b',
  } as unknown as Snapshot;
  expect(observation(snapshot, 2)).not.toHaveProperty('subtitleTrackId');
  expect(observation({ ...snapshot, pendingSubtitleTrackId: null, subtitleTrackId: 'sub-b' }, 3))
    .toHaveProperty('subtitleTrackId', 'sub-b');
  expect(observation({ ...snapshot, pendingSubtitleTrackId: null }, 4)).toHaveProperty('subtitleTrackId', null);
});

test('startup recovery offers brokered HLS on the same source, timeline and edition', () => {
  const original = { id: 'original', kind: 'direct', transport: 'file', url: '/original.mp4',
    mimeType: 'video/mp4', readiness: 'ready', sourceId: 'item', timelineId: 'timeline', edition: 'cut',
    qualities: [], boundaries: [] } satisfies PlaybackPath;
  const converted = { ...original, id: 'converted', kind: 'transcode', transport: 'hls',
    url: '/converted.m3u8', mimeType: 'application/vnd.apple.mpegurl' } satisfies PlaybackPath;
  const { url: _, ...lazy } = converted;
  const plan = {
    sessionId: 's', revision: 1, state: 'ready', positionSeconds: 15, sourceGeneration: 1, seekGeneration: 1,
    selectedSubtitleTrackId: null, selectedPathId: original.id, paths: [original, converted, { ...lazy, id: 'lazy', readiness: 'on-demand' },
      { ...converted, id: 'other-source', sourceId: 'other' }, { ...converted, id: 'other-edition', edition: '' },
      { ...converted, id: 'unknown-timeline', timelineId: undefined }, { ...converted, id: 'unavailable', readiness: 'unavailable' }],
    audioTracks: [], subtitleTracks: [], chapters: [], fallback: { state: 'idle' },
  } satisfies PlaybackPlan;
  const session = sessionFromPlan(plan, 'https://ether.test/vela/');
  expect(session.startupFallbackSources?.map(path => path.id)).toEqual(['converted', 'lazy']);
  expect(session.sources.find(source => source.id === 'converted')?.recoveryAllowed).toBe(false);
  expect(session.onDemandSources?.map(path => path.id)).toEqual(['lazy']);
  expect(sessionFromPlan({ ...plan, selectedPathId: converted.id }, 'https://ether.test/').startupFallbackSources).toEqual([]);
});

import { localMediaURL } from './local-media';
import { codecFamily } from './video-info';
import type { PlaybackPlan, PlaybackPath, PlayerObservation } from '../../../../packages/protocol/types';
import type { OnDemandSource, PlaybackSession, Snapshot } from './model';

function brokerSwitch(path: PlaybackPath): OnDemandSource {
  return { id: path.id, onDemand: true, delivery: path.transport, mime: path.mimeType, original: path.original };
}
/** Protocol paths contain server-qualified codec strings, never guessed capabilities. */
/** The plan's media URLs may be relative to the server; `mediaBase` is that server's origin (the
 * page's own when it serves both, as Ether does at /vela). */
export function sessionFromPlan(plan: PlaybackPlan, mediaBase: string = location.href): PlaybackSession {
  const local = plan.sessionId.startsWith('local-');
  const absolute = (url: string) => {
    if (!local) return new URL(url, mediaBase).href;
    const checked = localMediaURL(url);
    if (!checked) throw new Error('Local media URL is outside the downloads scope');
    return checked.href;
  };
  const selected = plan.paths.find((p) => p.id === plan.selectedPathId);
  if (!selected) throw new Error('Plan selected path is absent');
  const edition = selected.edition ?? '';
  const sameSource = (path: PlaybackPath) => path.id !== selected.id &&
    !!selected.sourceId && path.sourceId === selected.sourceId &&
    !!selected.timelineId && path.timelineId === selected.timelineId &&
    (path.edition ?? '') === edition;
  return {
    id: plan.sessionId,
    serverState: plan.state,
    serverControlled: !local,
    selectedSourceId: plan.selectedPathId,
    selectedVersionId: plan.selectedVersionId ?? undefined,
    mediaId: plan.titleId ?? plan.channelId ?? plan.extraId ?? plan.liveItemId ?? '',
    edition,
    position: plan.positionSeconds,
    duration: plan.durationSeconds,
    // A Live TV channel, or a library's live stream, which has no channel.
    live: !!plan.channelId || !!plan.live,
    startOver: plan.live?.mode === 'startOver',
    timeshift: !!plan.live?.timeshift,
    livePolicy: plan.livePolicy,
    liveWindowStart: plan.live?.windowStartSeconds,
    liveEdge: plan.live?.liveEdgeSeconds,
    liveMaxDrift: plan.live?.maxDriftSeconds,
    lowDelay: plan.live?.mode === 'low-delay',
    sourceGeneration: plan.sourceGeneration,
    seekGeneration: plan.seekGeneration,
    audioTrackId: plan.selectedAudioTrackId,
    subtitleTrackId: plan.selectedSubtitleTrackId ?? undefined,
    chapters: plan.chapters,
    audioTracks: plan.audioTracks.map((t) => ({
      id: t.id,
      label: t.name,
      default: t.default,
      language: t.language,
      codec: t.codec,
      channels: t.channels,
      streamIndex: t.streamIndex,
    })),
    subtitleTracks: plan.subtitleTracks.map((t) => ({
      id: t.id,
      label: t.name,
      language: t.language,
      codec: t.codec,
      streamIndex: t.streamIndex,
      url: t.delivery?.kind === 'external' ? absolute(t.delivery.url) : !local && t.url ? absolute(t.url) : undefined,
      delivery: t.delivery?.kind === 'external' ? { ...t.delivery, url: absolute(t.delivery.url) } : t.delivery,
      forced: t.forced,
      hearingImpaired: t.hearingImpaired,
    })),
    onDemandSources: plan.paths.filter(p => p.readiness === 'on-demand' && sameSource(p)).map(brokerSwitch),
    // A failed original has no running stream to splice. The broker can start its transcode
    // at the requested position on the same source, even if a ready path has no splice point there.
    startupFallbackSources: local || selected.kind !== 'direct' || selected.transport !== 'file' ? [] : plan.paths
      .filter(p => p.kind === 'transcode' && p.transport === 'hls' &&
        (p.readiness === 'on-demand' || p.readiness === 'ready') && sameSource(p))
      .map(brokerSwitch),
    sources: plan.paths
      .filter(
        (p): p is PlaybackPath & { readiness: 'ready'; url: string } =>
          p.readiness === 'ready' && (p.edition ?? '') === edition,
      )
      .map((p) => ({
        id: p.id,
        strategy: p.kind,
        delivery: p.transport,
        url: absolute(p.url),
        mime: p.mimeType,
        edition: p.edition ?? '',
        timeline: p.timelineId ?? `unverified:${p.id}`,
        audioTrackId: plan.selectedAudioTrackId,
        boundaries: p.boundaries.filter((b) => b.independent).map((b) => b.atSeconds),
        recoveryAllowed:
          p.id === selected.id ||
          (!!selected.timelineId &&
            !!p.timelineId &&
            p.boundaries.some(
              (b) =>
                b.independent &&
                (b.compatibility === 'verified-timeline' ||
                  (b.compatibility === 'same-source' && !!p.sourceId && p.sourceId === selected.sourceId)) &&
                b.timelineId === selected.timelineId &&
                (!plan.selectedAudioTrackId || b.audioTrackIds.includes(plan.selectedAudioTrackId)) &&
                (!plan.selectedSubtitleTrackId || b.subtitleTrackIds.includes(plan.selectedSubtitleTrackId)),
            )),
        quality: p.quality,
        original: p.original,
        originalVideo: p.originalVideo,
        sourceRevision: p.sourceId,
        timelineOriginSeconds: p.timelineOriginSeconds,
        initialRenditionId: p.initialRenditionId,
        audioRenditions: p.audioRenditions?.map((rendition) => ({ ...rendition, url: absolute(rendition.url) })),
        renditions: p.qualities.map((q) => ({
          id: q.id,
          url: absolute(q.url),
          bandwidth: q.bitrate,
          height: q.height,
          width: q.width,
          codec: q.codec ?? codecFamily(q.videoCodec),
          dynamicRange: q.dynamicRange,
          averageBitrate: q.averageBitrate,
          audioGroupId: q.audioGroupId,
          codecStatus: q.codecStatus === 'pending' || !q.videoCodec.trim() ? 'pending' : 'verified',
          mime: `video/mp4; codecs="${q.videoCodec}${q.audioCodec ? `,${q.audioCodec}` : ''}"`,
        })),
      })),
  };
}
/** Deliberately no decoder/bandwidth estimates when the backend cannot observe them. */
export function observation(snapshot: Snapshot, sequence: number): PlayerObservation | null {
  if (!snapshot.sessionId || !snapshot.sourceId) return null;
  return {
    idempotencyKey: `${snapshot.sessionId}:${snapshot.sourceGeneration}:${snapshot.seekGeneration}:${sequence}`,
    sourceGeneration: snapshot.sourceGeneration,
    seekGeneration: snapshot.seekGeneration,
    sequence,
    observedAt: new Date().toISOString(),
    positionSeconds: snapshot.position,
    state:
      snapshot.state === 'playing'
        ? 'playing'
        : snapshot.state === 'ended'
          ? 'ended'
          : snapshot.state === 'paused'
            ? 'paused'
            : 'buffering',
    playableRanges: snapshot.playable.map((r) => ({ startSeconds: r.start, endSeconds: r.end })),
    selectedPathId: snapshot.sourceId,
    ...(snapshot.throughputBps === null ? {} : { throughputBps: snapshot.throughputBps }),
    ...(snapshot.droppedFrames === null ? {} : { droppedFrames: snapshot.droppedFrames }),
    ...(snapshot.totalFrames === null ? {} : { totalFrames: snapshot.totalFrames }),
    ...(snapshot.audioTrackId === null || snapshot.audioClientOnly
      ? {}
      : { audioTrackId: snapshot.audioTrackId }),
    // A sidecar still opening must not report Off and clear the server selection.
    ...(snapshot.subtitleClientOnly || (snapshot.subtitleTrackId === null && snapshot.pendingSubtitleTrackId)
      ? {}
      : { subtitleTrackId: snapshot.subtitleReportingId ?? snapshot.subtitleTrackId }),
    ...(snapshot.failure
      ? {
          error: {
            class:
              snapshot.failure.kind === 'network'
                ? 'transient'
                : snapshot.failure.kind === 'decoder'
                  ? 'decoder'
                  : 'source',
            message: snapshot.failure.message,
          },
        }
      : {}),
  };
}

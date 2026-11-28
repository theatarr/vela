import type { VideoInfo, DynamicRange } from './video-info';
import type { PlaybackFormat } from './format-info';
import type { SessionCommand, AudioRendition, OriginalVideo, Chapter } from '../../../../packages/protocol/types';
import type { SubtitleDelivery, SubtitlePreferences } from './universal/subtitles/types';
/** Local engine input. protocol.ts translates the versioned server plan here. */
export interface Track {
  id: string;
  label: string;
  /** The plan marks this audio track as the default. */
  default?: boolean;
  language?: string;
  url?: string;
  codec?: string;
  channels?: number;
  streamIndex?: number;
  delivery?: SubtitleDelivery;
  forced?: boolean;
  hearingImpaired?: boolean;
}
export interface Rendition {
  id: string;
  url: string;
  bandwidth: number;
  mime: string;
  height?: number;
  width?: number;
  codec?: string;
  dynamicRange?: DynamicRange;
  averageBitrate?: number;
  audioGroupId?: string;
  codecStatus?: 'pending' | 'verified';
}
export function codecKnown(rendition: Rendition) {
  return rendition.codecStatus !== 'pending' && /codecs="[^"]+"/.test(rendition.mime);
}
export interface Source {
  id: string;
  strategy: 'direct' | 'remux' | 'transcode';
  delivery: 'file' | 'hls';
  url: string;
  mime: string;
  timeline: string;
  edition: string;
  audioTrackId?: string;
  recoveryAllowed?: boolean;
  boundaries?: number[];
  original?: boolean;
  originalVideo?: OriginalVideo;
  quality?: { width: number; height: number; bitrate: number; codec?: string; dynamicRange?: DynamicRange };
  sourceRevision?: string;
  timelineOriginSeconds?: number;
  audioRenditions?: AudioRendition[];
  initialRenditionId?: string;
  renditions?: Rendition[];
}
export interface OnDemandSource {
  id: string;
  onDemand: true;
  /** The path's delivery and type, so a page can tell it cannot play one before asking for it. */
  delivery?: Source['delivery'];
  mime?: string;
  original?: boolean;
}
export interface PlaybackSession {
  onDemandSources?: OnDemandSource[];
  startupFallbackSources?: OnDemandSource[];
  serverState?: 'ready' | 'playing' | 'paused' | 'recovering' | 'ended';
  id: string;
  mediaId: string;
  edition: string;
  selectedSourceId?: string;
  selectedVersionId?: string;
  serverControlled?: boolean;
  sources: Source[];
  position?: number;
  duration?: number;
  audioTracks: Track[];
  subtitleTracks: Track[];
  audioTrackId?: string;
  subtitleTrackId?: string;
  live?: boolean;
  startOver?: boolean;
  timeshift?: boolean;
  liveWindowStart?: number;
  liveEdge?: number;
  liveMaxDrift?: number;
  lowDelay?: boolean;
  sourceGeneration?: number;
  seekGeneration?: number;
  chapters?: Chapter[];
  livePolicy?: { latencyProfile: 'auto' | 'low' | 'stable'; targetLatencySeconds: number };
}
export type Command = { id: number } & (
  | { type: 'play' | 'pause' | 'pip' | 'fullscreen' | 'catchUp' | 'retry' }
  | { type: 'seekBy'; seconds: number }
  | { type: 'switchPath'; pathId: string }
  | { type: 'seek'; seconds: number }
  | { type: 'volume'; value: number }
  | { type: 'mute'; muted?: boolean }
  | { type: 'audio'; trackId: string }
  | { type: 'subtitle'; trackId: string | null }
  | { type: 'speed'; value: number }
  | { type: 'subtitleStyle'; value: string }
  /** A delivery choice, 'name=value' (surround=lossless, immersive=off, speakerLayout=7.1.4, dolbyVision=base-layer). */
  | { type: 'outputPreference'; value: string }
  | { type: 'quality'; renditionId: string | null }
  | { type: 'lowDelay'; enabled: boolean }
);
export type FailureKind = 'network' | 'source' | 'decoder' | 'unsupported' | 'action';
export interface Failure {
  kind: FailureKind;
  message: string;
  recoverable: boolean;
}
/** Session-local evidence survives a successful decoder/backend replacement. */
export interface RecoveryDiagnostic {
  atMilliseconds: number;
  sourceGeneration: number;
  seekGeneration: number;
  positionSeconds: number;
  delivery: Source['delivery'] | null;
  backend: Snapshot['backend'];
  kind: FailureKind;
  message: string;
  bufferAheadSeconds: number | null;
  readAheadSeconds: number | null;
}
export interface LiveSnapshot {
  edgeSeconds: number | null;
  windowStartSeconds: number | null;
  driftSeconds: number | null;
  edgeSource: 'playlist' | 'seekable' | 'server' | null;
  reconnecting: boolean;
  delivery: 'available' | 'waiting-for-publication' | 'segment-delayed' | 'upstream-gap' | 'unknown';
  canCatchUp: boolean;
}
export interface Snapshot {
  /** The platform joined live because the saved recovery position left the loaded window. */
  timeshiftRecoveryEvicted?: boolean | null;
  sessionId: string | null;
  sourceGeneration: number;
  seekGeneration: number;
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'recovering' | 'ended' | 'failed';
  sourceId: string | null;
  strategy: Source['strategy'] | null;
  backend: 'file' | 'native-hls' | 'mse' | 'webgpu' | 'aether-original' | 'aether-hls' | null;
  renditionId: string | null;
  qualityIds: string[];
  capabilities: { pip: boolean; fullscreen: boolean; audioSwitch: boolean };
  lockedQuality: string | null;
  audioTracks: Track[];
  subtitleTracks: Track[];
  renditions: (Omit<Rendition, 'url'> & { bitrateBps: number; requiredBandwidthBps: number })[];
  video: VideoInfo | null;
  /** Source → output video and audio facts for the info card; absent where the engine does not report them. */
  format?: PlaybackFormat | null;
  currentBitrateBps: number | null;
  requiredBandwidthBps: number | null;
  bufferAheadSeconds: number | null;
  /**
   * A count that grows while the engine gets somewhere with loading (media bytes received, packets
   * demuxed or decoded, startup steps passed), never on a timer; absent or null where the engine
   * cannot tell. Only its growth means anything: the host keeps waiting on a slow start while it grows.
   */
  loadProgress?: number | null;
  throughputHistory: number[];
  speed: number;
  speeds: number[];
  pendingSubtitleTrackId: string | null;
  chapters: Chapter[];
  subtitleError: string | null;
  subtitleStyle: SubtitlePreferences;
  subtitleStyleAvailable: boolean;
  subtitleReportingId?: string | null;
  subtitleClientOnly?: boolean;
  audioClientOnly?: boolean;
  /** The viewer's audio and picture delivery choices by name, and the names this engine honours, in menu order. */
  outputPreferences?: Record<string, string>;
  outputPreferencesAvailable?: string[];
  diagnostics?: {
    implementation?: 'vela-core' | 'upstream-controller' | 'vela-aether';
    metadataDiscrepancies: string[];
    subtitleFailures?: string[];
    recoveryHistory?: RecoveryDiagnostic[];
  };
  live: LiveSnapshot | null;
  seekTarget: number | null;
  waiting: boolean;
  volume: number;
  muted: boolean;
  preparation: 'media-metadata' | 'initial-buffer' | 'starting' | null;
  position: number;
  duration: number | null;
  playable: { start: number; end: number }[];
  throughputBps: number | null;
  droppedFrames: number | null;
  totalFrames: number | null;
  audioTrackIds: string[];
  audioTrackId: string | null;
  pendingAudioTrackId: string | null;
  subtitleTrackId: string | null;
  /** The plan's paths this engine cannot play here, with why (an original file on a plain-http
   * page, a file the browser has no player for); absent where the engine plays every path. */
  unplayablePaths?: { id: string; reason: 'insecure-page' | 'browser' }[];
  failure: Failure | null;
}
export type EngineEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | {
      type: 'error';
      failure: Failure;
      sessionId?: string | null;
      sourceGeneration?: number;
      seekGeneration?: number;
    }
  | { type: 'session-command'; sessionId: string; command: SessionCommand }
  | { type: 'session-refresh'; sessionId: string; reason?: 'original_lost'; positionSeconds?: number; sourceGeneration?: number };

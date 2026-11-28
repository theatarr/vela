// What the player chrome shows, from the server's plan and the view's latest snapshot: the
// clock, the timeline, the choosable tracks, qualities, speeds and chapters, and the playback
// facts for the info card. Pure: no React, no clock. A value the engine has not reported stays
// empty rather than estimated.
import { languageLabel, msg, number, playingRelease, second } from '@vela/core';
import { QUALITY_HEADROOM, videoInfo, type VideoInfo } from '../../../../../modules/vela-player/web/engine/video-info';
import type { Command, PlaybackPlan, Snapshot } from '@vela/player-api';
import { formatLines, type FormatLines } from './format';

type Path = PlaybackPlan['paths'][number];
type Range = VideoInfo['dynamicRange'];

/** A track as the menus list it: its name, then one muted detail ("English", "TrueHD · 8 ch"). */
export interface TrackOption {
  id: string;
  name: string;
  detail: string;
}

/** A quality: its resolution (or "Original"), what sets it apart, its rate and what it needs. */
export interface QualityOption {
  id: string;
  /** Equivalent server path/rendition identities, for current and pending checks. */
  aliases: string[];
  resolution: string;
  traits: string;
  rate: string;
  needs: string;
  /** An actionable choice; missing codec metadata is not a switch in progress. */
  disabledReason: string;
  /** The source file itself, not a conversion of it. */
  original: boolean;
}

export interface ChapterMark {
  id: string;
  name: string;
  seconds: number;
  /** Where it starts on the timeline, 0 to 1. */
  at: number;
}

export interface PlayerStats {
  bitrate: string;
  throughput: string;
  required: string;
  /** Measured throughput over what the quality needs; 0 when either is unknown. */
  headroom: number;
  /** Recent throughput samples, each 0 to 1 of the peak. */
  history: number[];
  buffer: string;
  resolution: string;
  video: string;
  delivery: string;
  dropped: string;
}

export interface SubtitleLook {
  size: string;
  background: string;
  color: string;
  position: string;
}

export interface PlayerView {
  state: Snapshot['state'];
  playing: boolean;
  ended: boolean;
  /** The engine is preparing, buffering, seeking or recovering. */
  waiting: boolean;
  position: number;
  duration: number;
  /** Played fraction, 0 to 1. */
  progress: number;
  elapsed: string;
  remaining: string;
  /** Media the engine holds, as fractions of the timeline. */
  buffered: { start: number; end: number }[];
  volume: number;
  muted: boolean;
  speed: number;
  /** The rates the engine offers; empty when it cannot change speed. */
  speeds: number[];
  audio: TrackOption[];
  audioId: string;
  pendingAudioId: string;
  subtitles: TrackOption[];
  subtitleId: string;
  pendingSubtitleId: string;
  subtitleError: string;
  subtitleLook: SubtitleLook | null;
  /** The subtitle delay in seconds (positive shows cues later); null where the engine has none. */
  subtitleOffset: number | null;
  qualities: QualityOption[];
  /** A Plex stream offered without an output size or rendition ladder. */
  serverStream?: { choice: string; selected: boolean };
  /** An Automatic row: the engine picks the rendition itself unless one is locked, or the player adapts across the
   * plan's adaptive HLS path (selected unless a quality is locked: a fixed path or the original plays). */
  qualityAuto: boolean;
  /** What the Automatic row sends: null for the engine's own rendition choice, or `path:<id>` of the plan's adaptive
   * HLS path, which a native player adapts across (Ether 0.3.25). */
  qualityAutoId: string | null;
  lockedQuality: string;
  /** The quality playing: a rendition id, or `path:<id>` for a path of one quality. */
  qualityId: string;
  /** The quality playing, in words ("1080p · 8 Mbps"). */
  quality: string;
  path: string;
  /** The release the server says is playing ("1080p WEB-DL · DD+ 5.1 · 4.2 GB"), and its row in
   * the versions menu (null: not a row; undefined: the server does not say). */
  playingLabel: string;
  playingVersionId: string | null | undefined;
  chapters: ChapterMark[];
  stats: PlayerStats;
  /** Source → output video and audio, from the engine's format facts. */
  format: FormatLines;
  /** The delivery choices the engine honours (audio menu), in order, with their current values. */
  output: { name: string; value: string }[];
  pip: boolean;
  fullscreen: boolean;
  /** The engine's own failure, in words ("" while it plays). */
  reason: string;
  recoverable: boolean;
}

/** Nudges the subtitle delay by a step ('+0.1', '-0.5'), or back to zero ('0'); positive shows cues later. */
export function nextSubtitleOffset(offset: number, step: string): number {
  const next = step === '0' ? 0 : offset + Number(step);
  return Math.max(-600, Math.min(600, Math.round(next * 1000) / 1000));
}

/** Seconds as a clock: 4:05, 1:02:09. */
export function timecode(total: number): string {
  const whole = Math.max(0, Math.floor(total));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const seconds = whole % 60;
  const two = (n: number) => number(n, { minimumIntegerDigits: 2, useGrouping: false });
  const plain = (n: number) => number(n, { useGrouping: false });
  return hours > 0 ? `${plain(hours)}:${two(minutes)}:${two(seconds)}` : `${plain(minutes)}:${two(seconds)}`;
}

function rate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return '';
  return `${number(bps / 1e6, { maximumFractionDigits: 1 })} Mbps`;
}

function resolutionOf(video: { width: number; height: number } | null | undefined): string {
  if (!video) return '';
  return video.width >= 3800 ? '4K' : `${number(video.height, { useGrouping: false })}p`;
}

function rangeName(range: Range | undefined): string {
  switch (range) {
    case 'dv':
      return 'Dolby Vision';
    case 'hdr10':
      return 'HDR10';
    case 'hlg':
      return 'HLG';
    case 'sdr':
      return 'SDR';
    default:
      return '';
  }
}

const CODECS: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };

function codecName(codec: string | undefined): string {
  if (!codec) return '';
  const family = /^(avc1|avc3)/i.test(codec) ? 'h264' : /^(hvc1|hev1)/i.test(codec) ? 'hevc' : /^av01/i.test(codec) ? 'av1' : /^vp09/i.test(codec) ? 'vp9' : codec;
  return CODECS[family] ?? codec.toUpperCase();
}

/** A track from the plan (named) or the engine (labelled). */
interface AnyTrack {
  id: string;
  name?: string;
  label?: string;
  language?: string;
  codec?: string;
  channels?: number;
  forced?: boolean;
  hearingImpaired?: boolean;
  delivery?: { kind: string; format?: string };
}

/** Metadata and engine discovery complement each other; an empty early snapshot must not
 * erase the plan's embedded or external tracks. Engine labels win for the same identity. */
function trackOptions(planned: AnyTrack[], observed: AnyTrack[], subtitle = false): TrackOption[] {
  const tracks = new Map(planned.map(track => [track.id, track]));
  for (const track of observed) {
    const previous = tracks.get(track.id);
    tracks.set(track.id, { ...previous, ...track, name: track.name ?? track.label ?? previous?.name,
      language: track.language ?? previous?.language, codec: subtitle ? [track.codec, previous?.codec].find(codec => subtitleFormat(codec)) : track.codec || previous?.codec });
  }
  return [...tracks.values()].map(track => trackOption(track, subtitle));
}

const SUBTITLE_FORMATS: Record<string, string> = {
  srt: 'SRT', subrip: 'SRT', 'application/x-subrip': 'SRT',
  ass: 'ASS', ssa: 'ASS', 'text/x-ssa': 'ASS',
  pgs: 'PGS', sup: 'PGS', hdmv_pgs_subtitle: 'PGS', 'application/pgs': 'PGS',
  vtt: 'WebVTT', webvtt: 'WebVTT', 'webvtt-window': 'WebVTT', 'text/vtt': 'WebVTT', 'application/x-mp4-vtt': 'WebVTT',
};

function subtitleFormat(codec: string | undefined): string {
  return SUBTITLE_FORMATS[(codec ?? '').trim().toLowerCase()] ?? '';
}

/** Name, language, codec, channels, forced, SDH: the first is the name, the rest its detail. */
function trackOption(track: AnyTrack, subtitle: boolean): TrackOption {
  const language = track.language && track.language !== 'und' ? track.language : '';
  const title = track.name ?? track.label ?? '';
  const format = subtitleFormat(track.delivery?.kind === 'external' ? track.delivery.format : track.codec);
  // A server title that only restates the language and format ("en PGS", "English · SRT") is not a
  // name: the language and format are shown on their own.
  const restated = new Set([language, language && languageLabel(language)].filter(Boolean).map(word => word.toLowerCase()));
  const onlyRestates = (part: string) => part.split(/\s+/).every(word =>
    !word || restated.has(word.toLowerCase()) || !!subtitleFormat(word) || /^(application|audio|text|video)\//i.test(word));
  const name = subtitle
    ? title.split(/\s*·\s*/).filter(part => !onlyRestates(part)).join(' · ')
    : title;
  const parts = [
    name,
    subtitle && language ? languageLabel(language) : language,
    subtitle ? format : (track.codec ?? '').toUpperCase(),
    track.channels ? `${track.channels} ch` : '',
    track.forced ? 'Forced' : '',
    track.hearingImpaired ? 'SDH' : '',
  ];
  const kept = parts.filter(
    (value, index) =>
      value && !parts.slice(0, index).some(previous => previous.toLowerCase().includes(value.toLowerCase())),
  );
  return { id: track.id, name: kept[0] ?? track.id, detail: kept.slice(1).join(' · ') };
}

function stats(snapshot: Snapshot | null): PlayerStats {
  const samples = (snapshot?.throughputHistory ?? []).filter(v => Number.isFinite(v) && v > 0).slice(-30);
  const peak = Math.max(0, ...samples);
  const throughput = snapshot?.throughputBps;
  const required = snapshot?.requiredBandwidthBps;
  const ahead = snapshot?.bufferAheadSeconds;
  const video = snapshot?.video ?? null;
  const dropped = snapshot?.droppedFrames;
  const decoded = snapshot?.totalFrames;
  return {
    bitrate: rate(snapshot?.currentBitrateBps),
    throughput: rate(throughput),
    required: rate(required),
    headroom: throughput && required ? throughput / required : 0,
    history: peak ? samples.map(v => v / peak) : [],
    buffer: ahead == null ? '' : second(ahead, 1),
    resolution: resolutionOf(video),
    video: [codecName(video?.codec), rangeName(video?.dynamicRange ?? undefined)].filter(Boolean).join(' · '),
    delivery: snapshot?.strategy
      ? msg(snapshot.strategy === 'direct' ? 'data.statsDirect' : 'data.statsConverted')
      : '',
    dropped:
      dropped == null || decoded == null
        ? ''
        : msg('data.frameCount', { dropped: number(dropped), decoded: number(decoded) }),
  };
}

function needs(bitrate: number | undefined): string {
  const needed = rate(bitrate ? bitrate * QUALITY_HEADROOM : undefined);
  return needed ? msg('data.needsBandwidth', { bandwidth: needed }) : '';
}

/** Several paths may play the same title: the one playing, and those it can switch to. */
function siblings(plan: PlaybackPlan, current: Path | undefined): Path[] {
  if (!current?.sourceId || !current.timelineId) return [];
  return plan.paths.filter(
    p =>
      p.sourceId === current.sourceId &&
      p.timelineId === current.timelineId &&
      (p.edition ?? '') === (current.edition ?? ''),
  );
}

/** Why the engine cannot play a path on this page (Snapshot.unplayablePaths), in the viewer's
 * words: an original file over plain http (no WebCodecs), or a file the browser has no player for.
 * Empty where it can, or where the engine does not say. */
export function unplayableReason(pathId: string, snapshot: Snapshot | null): string {
  const reason = snapshot?.unplayablePaths?.find(entry => entry.id === pathId)?.reason;
  if (!reason) return '';
  return msg(reason === 'insecure-page' ? 'player.qualityReason.insecurePage' : 'player.qualityReason.browser');
}

/** Whether a path is a multi-variant HLS master the player adapts across (Ether 0.3.25 `adaptive`). */
function adapts(path: Path | undefined): boolean {
  return path?.transport === 'hls' && path.adaptive === true;
}

/** The plan's server path of one quality a rung of an adaptive ladder stands for: of the rung's height, its rate the
 * nearest to the rung's. A player that adapts across the master itself cannot hold one rung of it (AVPlayer, Media3
 * here): a viewer's rung leaves the adaptive path for that server path, as the protocol has explicit choices do. */
export function fixedPathFor(plan: PlaybackPlan, current: Path, rung: { height: number; bitrate?: number }): Path | undefined {
  const rate = (p: Path) => p.quality!.averageBitrate ?? p.quality!.bitrate;
  return plan.paths
    .filter(p => p.id !== current.id && !adapts(p) && !p.original && p.quality?.height === rung.height
      && (p.readiness === 'ready' || p.readiness === 'on-demand')
      && (!p.sourceId || !current.sourceId || p.sourceId === current.sourceId) && (p.edition ?? '') === (current.edition ?? ''))
    .sort((a, b) => Math.abs(rate(a) - (rung.bitrate ?? 0)) - Math.abs(rate(b) - (rung.bitrate ?? 0)))[0];
}

/** `pinsRenditions`: the engine holds one rendition of an HLS ladder itself (the web's); otherwise a rung of an
 * adaptive path is offered as the server path of its height (fixedPathFor), or unavailable without one. */
function qualities(plan: PlaybackPlan | null, current: Path | undefined, snapshot: Snapshot | null, pinsRenditions = true): QualityOption[] {
  if (!plan) return [];
  const unplayable = (p: Path) => !!unplayableReason(p.id, snapshot);
  const originals = plan.paths
    .filter(p => p.original || p.id === 'primary' || p.kind === 'direct' && p.transport === 'file')
    .filter(p => p.readiness === 'ready' || p.readiness === 'on-demand')
    .filter(p => !current || ((!p.sourceId || !current.sourceId || p.sourceId === current.sourceId)
      && (!p.timelineId || !current.timelineId || p.timelineId === current.timelineId)
      && (p.edition ?? '') === (current.edition ?? '')))
    // The one playing, else one this page can play (a browser-friendly file before an MKV it cannot).
    .sort((a, b) => Number(b.id === current?.id) - Number(a.id === current?.id) || Number(unplayable(a)) - Number(unplayable(b)))
    .slice(0, 1)
    .map((p): QualityOption => {
      const facts = p.quality ?? videoInfo(p.originalVideo ?? {});
      const range = p.quality?.dynamicRange ?? videoInfo(p.originalVideo ?? {})?.dynamicRange ?? undefined;
      return {
        id: `path:${p.id}`,
        aliases: [],
        resolution: msg('data.original'),
        traits: [resolutionOf(facts), codecName(facts?.codec), rangeName(range)].filter(Boolean).join(' · '),
        rate: rate(p.quality?.bitrate),
        needs: '',
        disabledReason: p.id === current?.id ? '' : unplayableReason(p.id, snapshot),
        original: true,
      };
    });
  // Plex/Jellyfin may publish a fixed HLS URL; its ladder arrives from the
  // engine's manifest probe rather than the server plan.
  const ladder = [...(current?.qualities ?? [])];
  for (const q of snapshot?.renditions ?? []) {
    if (!q.height || !q.width) continue;
    const entry = { id: q.id, width: q.width, height: q.height, bitrate: q.bitrateBps || q.bandwidth,
      videoCodec: q.codec ?? '', dynamicRange: q.dynamicRange, codecStatus: q.codecStatus, url: '' };
    const index = ladder.findIndex(value => value.id === q.id);
    if (index >= 0) ladder[index] = { ...ladder[index]!, ...entry };
    else ladder.push(entry);
  }
  // A rung of an adaptive path the engine cannot hold is the server path of its height (fixedPathFor).
  const held = pinsRenditions || !adapts(current);
  const fixed = new Map(held ? [] : ladder.map(q => [q.id, fixedPathFor(plan, current!, q)] as const));
  const renditions = ladder.map(
    (q): QualityOption => {
      const path = fixed.get(q.id);
      return {
        id: held || !path ? q.id : `path:${path.id}`,
        aliases: [],
        resolution: resolutionOf(q),
        traits: [q.videoCodec ? codecName(q.videoCodec) : '', rangeName(q.dynamicRange)].filter(Boolean).join(' · '),
        rate: rate(q.bitrate),
        needs: needs(q.bitrate),
        disabledReason: held ? '' : path ? unplayableReason(path.id, snapshot) : msg('player.quality.automaticOnly'),
        original: false,
      };
    },
  );
  const switchable = siblings(plan, current)
    .filter(p => !p.original && p.id !== 'primary' && !(p.kind === 'direct' && p.transport === 'file'))
    .filter(p => (p.readiness === 'on-demand' || p.readiness === 'ready') && p.quality)
    .map(
      (p): QualityOption => ({
        id: `path:${p.id}`,
        aliases: [],
        resolution: resolutionOf(p.quality!),
        traits: [codecName(p.quality!.codec), rangeName(p.quality!.dynamicRange)].filter(Boolean).join(' · '),
        rate: rate(p.quality!.bitrate),
        needs: needs(p.quality!.bitrate),
        disabledReason: unplayableReason(p.id, snapshot),
        original: false,
      }),
    );
  // A server path and its HLS rendition can describe the same viewer choice.
  // Prefer a usable server switch to an unverified rendition; otherwise keep
  // the current HLS ladder so pinning remains local to that source.
  const byResolution = new Map<string, QualityOption>();
  for (const option of [...switchable, ...renditions]) {
    const existing = byResolution.get(option.resolution);
    const rendition = ladder.find(q => q.id === option.id);
    if (!existing || (rendition && rendition.codecStatus !== 'pending') || (existing.disabledReason && !option.disabledReason))
      byResolution.set(option.resolution, option);
  }
  for (const option of [...originals, ...renditions, ...switchable]) option.aliases = [option.id];
  // A rung offered as a server path is still that rung.
  if (!held) ladder.forEach((q, i) => { if (renditions[i]!.id !== q.id) renditions[i]!.aliases.push(q.id); });
  for (const option of [...renditions, ...switchable]) {
    const chosen = byResolution.get(option.resolution)!;
    if (!chosen.aliases.includes(option.id)) chosen.aliases.push(option.id);
  }
  for (const limitation of plan.qualityLimitations ?? []) {
    // A height of 0 is a session-wide denial (conversion off, service down, owner policy): one
    // explanatory row, never a fabricated "0p" resolution.
    const sessionWide = !(limitation.height > 0);
    const resolution = sessionWide ? msg('player.qualitySessionLimited') : limitation.height >= 2160 ? '4K' : `${limitation.height}p`;
    if (!byResolution.has(resolution)) byResolution.set(resolution, {
      id: sessionWide ? 'unavailable:session' : `unavailable:${limitation.height}`, aliases: [], resolution, traits: '', rate: '', needs: '',
      disabledReason: qualityLimitReason(limitation.reason), original: false,
    });
  }
  const order = (option: QualityOption) => option.resolution === '4K' ? 2160 : Number.parseInt(option.resolution) || 0;
  return [...originals, ...[...byResolution.values()].sort((a, b) => order(b) - order(a))];
}

const QUALITY_REASONS = ['output_profile_unavailable', 'transcoding_disabled', 'quality_service_unavailable', 'owner_policy', 'decoder_profile_limit'];

/** Ether's quality limitation codes as viewer text; an unknown code is never shown raw. */
export function qualityLimitReason(code: string | undefined): string {
  if (!code) return msg('player.qualityUnavailable');
  if (QUALITY_REASONS.includes(code)) return msg(`player.qualityReason.${code}`);
  // A server may already send viewer text; a bare machine code it does not explain stays hidden.
  return /^[a-z0-9_.-]+$/.test(code) ? msg('player.qualityReason.other') : code;
}

/** The server's reason a plan has no adaptive path, in the viewer's words: its localized message, else its own
 * text, or a plain line for a bare machine code it does not explain. */
export function adaptiveUnavailableText(reason: string | undefined, message?: string): string {
  const text = (typeof message === 'string' ? message.trim() : '') || (typeof reason === 'string' ? reason.trim() : '');
  if (!text) return '';
  return /^[a-z0-9_.-]+$/.test(text) ? msg('player.quality.adaptiveUnavailable') : text;
}

/** Why the plan's playing path cannot adapt (Ether 0.3.25 sends `adaptiveUnavailable` and its localized
 * `adaptiveUnavailableMessage` on the selected path), in the viewer's words; '' when it adapts or the server says nothing. */
export function adaptiveUnavailableNote(plan: PlaybackPlan | null | undefined): string {
  const path = plan?.paths.find(candidate => candidate.id === plan.selectedPathId);
  const value: unknown = path?.adaptiveUnavailable;
  // Ether sends { reason, message }; earlier lab builds sent the code as a string beside adaptiveUnavailableMessage.
  if (value && typeof value === 'object') {
    const { reason, message } = value as { reason?: unknown; message?: unknown };
    return adaptiveUnavailableText(typeof reason === 'string' ? reason : undefined, typeof message === 'string' ? message : undefined);
  }
  return adaptiveUnavailableText(typeof value === 'string' ? value : undefined,
    typeof path?.adaptiveUnavailableMessage === 'string' ? path.adaptiveUnavailableMessage : undefined);
}

/** The resolution a release label leads with ("1080p WEB-DL · …" → "1080p"), or ''. */
export function labelResolution(label: string): string {
  const lead = /^\s*(4K|UHD|2160p|1440p|1080p|1080i|720p|576p|480p|SD)\b/i.exec(label)?.[1] ?? '';
  if (/^(4k|uhd|2160p)$/i.test(lead)) return '4K';
  return lead && /^sd$/i.test(lead) ? 'SD' : lead.toLowerCase();
}

/** A path that plays its release as it is (no conversion of the server's to a size of its own). */
function playsRelease(path: Path | undefined): boolean {
  return !!path && (path.original === true || path.id === 'primary' || (path.kind !== 'transcode' && !path.quality));
}

/** Whether a decoded picture this wide is of the class a label's resolution names (a 1920×800
 * scope picture is "1080p"; the 818p rung of a 4K release's ladder is not "4K"). */
function widthIs(width: number, named: string): boolean {
  const named1080 = named === '1080i' ? '1080p' : named;
  const decoded = width >= 3800 ? '4K' : width >= 1900 ? '1080p' : width >= 1260 ? '720p' : 'SD';
  return decoded === named1080 || (decoded === 'SD' && ['576p', '480p', 'SD'].includes(named1080));
}

function playingQuality(snapshot: Snapshot | null, s: PlayerStats, path: Path | undefined, release: string): string {
  // Playing a release as it is, the badge names it as its label does when the picture is that
  // release's size: a 1920×800 scope picture is the "1080p" release the menus name, not "800p".
  // A lower rung of the release's ladder keeps its own size.
  const named = playsRelease(path) ? labelResolution(release) : '';
  const width = snapshot?.video?.width ?? 0;
  if (named && (!width || widthIs(width, named))) return [named, s.bitrate].filter(Boolean).join(' · ');
  if (s.resolution) return [s.resolution, s.bitrate].filter(Boolean).join(' · ');
  const picked = path?.qualities.find(q => q.id === snapshot?.renditionId) ?? path?.quality;
  if (picked) return `${number(picked.height, { useGrouping: false })}p`;
  if (path?.id === 'primary' || path?.kind === 'direct') return msg('data.original');
  if (snapshot?.backend === 'native-hls') return msg('data.fixedQuality');
  return msg('data.starting');
}

function lockedQuality(snapshot: Snapshot | null, path: Path | undefined): string {
  const fixedPath = path && (path.original || (!path.qualities.length && (path.id === 'primary' || path.quality)));
  return fixedPath ? `path:${path.id}` : (snapshot?.lockedQuality ?? '');
}

/** A snapshot belongs to the plan when it names its session and generations. */
export function belongs(snapshot: Snapshot | null, plan: PlaybackPlan | null): snapshot is Snapshot {
  return (
    !!snapshot &&
    !!plan &&
    snapshot.sessionId === plan.sessionId &&
    snapshot.sourceGeneration === plan.sourceGeneration &&
    snapshot.seekGeneration === plan.seekGeneration
  );
}

/** The command a view is handed: a track command names a track of the file of the session it was
 * sent on (`sentOn`), so a view mounted for a replacement session does not replay it there, and a
 * queued transport command belongs to the engine that received it. */
export function viewCommand(command: Command | undefined, sentOn: string, sessionId: string): Command | undefined {
  return command && ['audio', 'subtitle', 'play', 'pause', 'seek', 'seekBy', 'catchUp'].includes(command.type) && sentOn !== sessionId ? undefined : command;
}

/** An audio or subtitle pick awaiting the player: the session and the file (`planSource`) it was made
 * on, and the track (null: Off). */
export interface PendingPick { sessionId: string; source: string | undefined; trackId: string | null }

/** The file a plan plays: its selected path's `sourceId`; without one, the release playing (`playingVersionId`,
 * or `selectedVersionId` when the plan does not say which plays); undefined when nothing names it. The
 * row alone tells files apart but an equal row does not prove the same file (`settlePick` only drops on a difference). */
export function planSource(plan: PlaybackPlan | null | undefined): string | undefined {
  if (!plan) return undefined;
  const version = plan.playingVersionId !== undefined ? plan.playingVersionId : plan.selectedVersionId;
  return plan.paths?.find(path => path.id === plan.selectedPathId)?.sourceId || version || undefined;
}

/** What a report of `plan` does to a pending pick: confirms it as the viewer's choice, drops it, or
 * leaves it waiting. A pick names a track of the file it was made on, so a report of another file
 * (the next version, whichever of its plan and the switch reply came first) drops it unconfirmed.
 * When either file is unknown, the pick is judged by the report alone. */
export function settlePick(pick: PendingPick, kind: 'audio' | 'subtitle', snapshot: Snapshot, plan: PlaybackPlan | null): 'confirm' | 'drop' | 'wait' {
  if (pick.sessionId !== plan?.sessionId) return 'wait';
  const now = planSource(plan);
  if (pick.source && now && pick.source !== now) return 'drop';
  if (kind === 'audio') return !snapshot.pendingAudioTrackId && snapshot.audioTrackId === pick.trackId ? 'confirm' : 'wait';
  if (snapshot.pendingSubtitleTrackId) return 'wait';
  if (snapshot.subtitleError) return 'drop';
  return (snapshot.subtitleTrackId || null) === pick.trackId ? 'confirm' : 'wait';
}

/** Where Try again or a return to the foreground starts the session again: the last reported position, a zero
 * only when the player presented it (a zero reported while loading is a reset clock, so the start point stands). */
export function restartAt(position: number, presented: boolean): number | undefined {
  return position > 0 || presented ? position : undefined;
}

/** Whether the position a report leaves was presented: a playing or paused report says so; a recovering,
 * failed or ended one keeps what the report before it said at the same place and generations (the player
 * retrying its read there, then failing); any other report (the player loading, buffering or idle) or a new
 * generation does not. */
export function presentedAfter(presented: boolean, last: Snapshot | null, next: Snapshot): boolean {
  if (next.state === 'playing' || next.state === 'paused') return true;
  return presented && (next.state === 'recovering' || next.state === 'failed' || next.state === 'ended') && !!last && last.sessionId === next.sessionId &&
    last.sourceGeneration === next.sourceGeneration && last.seekGeneration === next.seekGeneration && last.position === next.position;
}

/** Server acceptance can precede the engine switching; only its fresh, ready snapshot settles the choice. */
export function qualityReached(id: string, snapshot: Snapshot | null, plan: PlaybackPlan | null): boolean {
  if (!belongs(snapshot, plan) || snapshot.waiting || snapshot.state === 'failed') return false;
  if (id === 'auto') return !snapshot.lockedQuality;
  return id.startsWith('path:') ? snapshot.sourceId === id.slice(5) : snapshot.renditionId === id;
}

/** The last answer for the same arguments (by identity). The chrome redraws its view every second for the
 * clock; the session keeps a report's facts (tracks, renditions, format) the same objects while they do not
 * change (snapshot-pace.ts withClock), so the menus' rows are not worked out again each time. */
function lastFor<A extends unknown[], R>(make: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | null = null;
  return (...args: A) => {
    if (last && last.args.length === args.length && last.args.every((arg, i) => Object.is(arg, args[i]))) return last.value;
    const value = make(...args);
    last = { args, value };
    return value;
  };
}
const audioOptions = lastFor((planned: AnyTrack[], observed: AnyTrack[]) => trackOptions(planned, observed));
const subtitleOptions = lastFor((planned: AnyTrack[], observed: AnyTrack[]) => trackOptions(planned, observed, true));
const qualityOptions = lastFor((plan: PlaybackPlan | null, path: Path | undefined, renditions: Snapshot['renditions'] | undefined,
  unplayable: Snapshot['unplayablePaths'], pinsRenditions: boolean) => qualities(plan, path, { renditions, unplayablePaths: unplayable } as Snapshot, pinsRenditions));
const formatOf = lastFor((format: Snapshot['format']) => formatLines(format));
const chapterMarks = lastFor((chapters: PlaybackPlan['chapters'] | undefined, duration: number): ChapterMark[] => (chapters ?? []).map(c => ({
  id: c.id,
  name: c.name,
  seconds: c.startSeconds,
  at: duration > 0 ? Math.min(1, c.startSeconds / duration) : 0,
})));
const outputChoices = lastFor((available: string[] | undefined, preferences: Record<string, string> | undefined) =>
  (available ?? []).flatMap(name => {
    const value = preferences?.[name];
    return value ? [{ name, value }] : [];
  }));
const subtitleLookOf = lastFor((available: boolean | undefined, style: Snapshot['subtitleStyle'] | undefined): SubtitleLook | null =>
  available && style ? { size: style.subtitleSize, background: style.subtitleBackground, color: style.subtitleColor, position: style.subtitlePosition } : null);
const serverStreamOf = lastFor((choice: string, selected: boolean) => ({ choice, selected }));
const NO_TRACKS: AnyTrack[] = [];

export function present(plan: PlaybackPlan | null, own: Snapshot | null): PlayerView {
  const snapshot = belongs(own, plan) ? own : null;
  const position = snapshot?.seekTarget ?? snapshot?.position ?? plan?.positionSeconds ?? 0;
  const duration = snapshot?.duration ?? plan?.durationSeconds ?? 0;
  const path = plan?.paths.find(p => p.id === (snapshot?.sourceId ?? plan.selectedPathId));
  const unnamed = plan && siblings(plan, path).find(p =>
    p.id === 'plex-hls' && p.transport === 'hls' && (p.kind === 'transcode' || p.kind === 'remux') &&
    (p.readiness === 'ready' || p.readiness === 'on-demand') && !p.quality && !p.qualities.length &&
    !(p.id === path?.id && snapshot?.renditions?.some(q => q.width && q.height)));
  const state: Snapshot['state'] = snapshot?.seekTarget != null ? 'buffering' : (snapshot?.state ?? 'loading');
  const facts = stats(snapshot);
  const style = snapshot?.subtitleStyle;
  const rendition = snapshot?.backend === 'mse' || snapshot?.diagnostics?.implementation === 'vela-core';
  const playing = playingRelease(plan);
  const auto = automatic(plan, path, rendition, snapshot?.renditions?.length ?? 0);
  return {
    state,
    playing: state === 'playing',
    ended: state === 'ended',
    waiting:
      state !== 'failed' &&
      ((snapshot?.waiting ?? true) || ['idle', 'loading', 'buffering', 'recovering'].includes(state)),
    position,
    duration,
    progress: duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0,
    elapsed: timecode(position),
    remaining: duration > 0 ? `-${timecode(Math.max(0, duration - position))}` : plan?.live ? msg('data.live') : '',
    buffered:
      duration > 0
        ? (snapshot?.playable ?? []).map(r => ({
            start: Math.max(0, r.start / duration),
            end: Math.min(1, r.end / duration),
          }))
        : [],
    volume: snapshot?.volume ?? 1,
    muted: snapshot?.muted ?? false,
    speed: snapshot?.speed ?? 1,
    speeds: snapshot?.speeds ?? [],
    audio: audioOptions(plan?.audioTracks ?? NO_TRACKS, snapshot?.audioTracks ?? NO_TRACKS),
    audioId: snapshot?.audioTrackId ?? plan?.selectedAudioTrackId ?? plan?.audioTracks.find(track => track.default)?.id ?? '',
    pendingAudioId: snapshot?.pendingAudioTrackId ?? '',
    subtitles: subtitleOptions(plan?.subtitleTracks ?? NO_TRACKS, snapshot?.subtitleTracks ?? NO_TRACKS),
    subtitleId: snapshot ? (snapshot.subtitleTrackId ?? '') : (plan?.selectedSubtitleTrackId ?? ''),
    pendingSubtitleId: snapshot?.pendingSubtitleTrackId ?? '',
    subtitleError: snapshot?.subtitleError ?? '',
    subtitleLook: subtitleLookOf(snapshot?.subtitleStyleAvailable, style),
    subtitleOffset: style && Number.isFinite(style.offsetSeconds) ? style.offsetSeconds : null,
    // Of the report, only its renditions and unplayable paths make the rows.
    qualities: qualityOptions(plan, path, snapshot?.renditions, snapshot?.unplayablePaths, rendition),
    serverStream: unnamed ? serverStreamOf(`path:${unnamed.id}`, path?.id === unnamed.id) : undefined,
    qualityAuto: auto.offered,
    qualityAutoId: auto.id,
    // Automatic as the adaptive path: any other path playing (the original, a fixed rung) is a quality held.
    lockedQuality: auto.id && path && !adapts(path) ? `path:${path.id}` : lockedQuality(snapshot, path),
    qualityId: snapshot?.renditions?.some(q => q.id === snapshot.renditionId) || path?.qualities.some(q => q.id === snapshot?.renditionId)
      ? snapshot!.renditionId!
      : path
        ? `path:${path.id}`
        : '',
    quality: playingQuality(snapshot, facts, path, playing?.label ?? ''),
    path: snapshot?.strategy || path?.kind ? msg(`data.${snapshot?.strategy ?? path?.kind}`) : '',
    playingLabel: playing?.label ?? '',
    playingVersionId: playing ? playing.versionId : undefined,
    chapters: chapterMarks(plan?.chapters, duration),
    stats: facts,
    format: formatOf(snapshot?.format),
    output: outputChoices(snapshot?.outputPreferencesAvailable, snapshot?.outputPreferences),
    pip: snapshot?.capabilities.pip ?? false,
    fullscreen: snapshot?.capabilities.fullscreen ?? false,
    reason: snapshot?.failure?.message ?? '',
    recoverable: snapshot?.failure?.recoverable ?? true,
  };
}

/**
 * The Automatic row: an engine that picks HLS renditions itself (the web's) offers its own over a ladder of more than
 * one (sent as null). Any other player adapts only across the plan's adaptive HLS path (Ether 0.3.25 `adaptive`):
 * Automatic is that path, checked while it plays, and picking it from a fixed rung or the original returns to it.
 */
export function automatic(plan: PlaybackPlan | null, path: Path | undefined, pinsRenditions: boolean, reported = 0): { offered: boolean; id: string | null } {
  if (pinsRenditions && Math.max(path?.qualities.length ?? 0, reported) > 1) return { offered: true, id: null };
  const adaptive = adapts(path) ? path : plan?.paths.find(p => adapts(p) && (p.readiness === 'ready' || p.readiness === 'on-demand')
    && (!p.sourceId || !path?.sourceId || p.sourceId === path.sourceId));
  return adaptive ? { offered: true, id: `path:${adaptive.id}` } : { offered: false, id: null };
}

/** Where the bubble's left edge sits: centred on the target, clamped to the timeline. */
export function bubbleLeft(fraction: number, trackWidth: number, bubbleWidth: number): number {
  const centred = fraction * trackWidth - bubbleWidth / 2;
  return Math.max(0, Math.min(Math.max(0, trackWidth - bubbleWidth), centred));
}

/** How far the timeline takes touches above and below its drawn row: on a phone or touch screen,
 * 10 points above and 12 below the 22-point row (44 in all); a mouse or a TV keeps the row. */
export function scrubberReach(tv: boolean, handheld: boolean): { above: number; below: number } {
  return !tv && handheld ? { above: 10, below: 12 } : { above: 0, below: 0 };
}

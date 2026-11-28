import { ReadRetryBudget, transientReadFailure } from '../read-retry';
import { playbackMark } from '../timing';
import { decoderRetry } from '../universal/retry';
import type { Failure } from '../model';
import { delay, type Generation } from '../session';
import { PlaybackFault } from '../pipeline';
import type { HostContext } from './state';
import { readPosition, readDuration, readFrameMetrics } from './position';
import { detachMedia } from './native-events';
import { resetMedia, activateSource, releaseOriginal } from './media';
import { emitHostEvent, publishHostState } from './events';
import { routeKey, candidateSources } from './quality';
import { requestSwitch } from './authorizations';
export function failPlayback(context: HostContext, failure: Failure) {
  const position = readPosition(context);
  const duration = readDuration(context);
  const metrics = readFrameMetrics(context);
  context.session.pendingSeek = undefined;
  context.playback.failure = failure;
  context.playback.status = 'failed';
  context.session.controller.cancel();
  detachMedia(context);
  resetMedia(context);
  context.playback.terminalMedia = { position, duration, ...metrics };
  emitHostEvent(context, { type: 'error', failure });
  context.telemetry.lastObservation = -Infinity;
  publishHostState(context);
}
export const readRetries = new WeakMap<HostContext, ReadRetryBudget>();
export async function recoverPlayback(context: HostContext, error: unknown, token: Generation) {
  if (!context.session.controller.current(token) || context.recovery.active) return;
  context.recovery.active = true;
  const kind =
    error instanceof PlaybackFault
      ? error.kind
      : error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')
        ? 'network'
        : 'source';
  const position = readPosition(context);
  const failure: Failure = {
    kind,
    message: error instanceof Error ? error.message : String(error),
    recoverable: true,
  };
  const readout = context.media.runtime?.readout;
  context.recovery.history.record({
    atMilliseconds: performance.now(),
    sourceGeneration: context.session.controller.source,
    seekGeneration: context.session.controller.seek,
    positionSeconds: position,
    delivery: context.media.source?.delivery ?? null,
    backend: context.media.backend,
    kind,
    message: failure.message,
    bufferAheadSeconds: readout?.bufferAheadSeconds ?? null,
    readAheadSeconds: readout?.readAheadSeconds ?? null,
  });
  if (context.watchdog.startTimer) clearTimeout(context.watchdog.startTimer);
  context.watchdog.startTimer = undefined;
  playbackMark('source:failed');
  context.playback.status = 'recovering';
  context.playback.failure = null;
  publishHostState(context, true);
  const local = context.session.current?.id.startsWith('local-');
  const readFailure = !local && transientReadFailure(failure.message, kind);
  try {
    if (context.media.source && readFailure) {
      let budget = readRetries.get(context);
      const key = `${token.sessionId}:${context.media.source.id}`;
      if (!budget || budget.key !== key) {
        budget = new ReadRetryBudget(key);
        readRetries.set(context, budget);
      }
      const wait = budget.next(performance.now());
      if (wait !== null) {
        const source = context.media.source;
        detachMedia(context);
        resetMedia(context);
        await delay(wait, token.signal);
        if (!context.session.controller.current(token)) return;
        context.recovery.active = false;
        await activateSource(context, source, position, true, true);
        return;
      }
    }
    const retry =
      !readFailure && context.media.backend === 'webgpu' &&
      (!failure.message.startsWith('Original first-frame deadline') ||
        context.media.runtime?.readout.decoderReady)
        ? decoderRetry(failure.message)
        : null;
    if (retry && context.media.source && !context.recovery.localDecoderRetries.has(context.media.source.id)) {
      context.recovery.localDecoderRetries.add(context.media.source.id);
      context.recovery.active = false;
      // Local decoder replacement retains the broker's source/seek identity.
      await activateSource(context, context.media.source, position, true, true, retry);
      return;
    }
    if (
      !readFailure && context.media.backend === 'webgpu' &&
      context.media.source &&
      (context.media.source.delivery === 'hls' ||
        (local && !!context.surface.video.canPlayType(context.media.source.mime))) &&
      !context.recovery.browserFallbacks.has(routeKey(context, context.media.source))
    ) {
      context.recovery.browserFallbacks.add(routeKey(context, context.media.source));
      if (context.recovery.browserFallbacks.size > 32)
        context.recovery.browserFallbacks.delete(context.recovery.browserFallbacks.values().next().value!);
      context.recovery.active = false;
      await activateSource(context, context.media.source, position, true, true);
      return;
    }
    // The segment pipeline could not start this stream (a playlist or codec it does not take):
    // the browser's own HLS, where there is one, gets one try before the next source.
    if (
      !readFailure &&
      context.media.backend === 'mse' &&
      !context.watchdog.everPlayed &&
      context.media.source?.delivery === 'hls' &&
      !context.recovery.segmentFallbacks.has(routeKey(context, context.media.source)) &&
      context.surface.video.canPlayType('application/vnd.apple.mpegurl')
    ) {
      context.recovery.segmentFallbacks.add(routeKey(context, context.media.source));
      if (context.recovery.segmentFallbacks.size > 32)
        context.recovery.segmentFallbacks.delete(context.recovery.segmentFallbacks.values().next().value!);
      context.recovery.active = false;
      await activateSource(context, context.media.source, position, true, true);
      return;
    }
    context.playback.resumePosition = position;
    releaseOriginal(context);
    // Requests already retry twice; source handoff is bounded by plan length.
    await delay(300, token.signal);
    // A delayed recovery must not fail media that has since genuinely resumed.
    if (
      !context.surface.video.error &&
      context.surface.video.readyState >= 3 &&
      (!context.surface.video.paused || !context.playback.wantsPlay)
    ) {
      context.playback.status = context.surface.video.paused ? 'paused' : 'playing';
      context.playback.failure = null;
      context.telemetry.lastObservation = -Infinity;
      publishHostState(context);
      return;
    }
    const session = context.session.current;
    const currentSource = context.media.source;
    const startupFallback = session?.serverControlled && !context.watchdog.everPlayed &&
      currentSource?.strategy === 'direct' && currentSource.id === session.selectedSourceId
      ? session.startupFallbackSources?.find(s => !context.recovery.attempted.has(s.id))
      : undefined;
    if (startupFallback) {
      context.recovery.attempted.add(startupFallback.id);
      requestSwitch(context, startupFallback, position, true);
      return;
    }
    const source = candidateSources(context).find(
      (s) =>
        !context.recovery.attempted.has(s.id) &&
        s.recoveryAllowed !== false &&
        (!session?.serverControlled || s.boundaries?.some(at => at <= position)) &&
        s.timeline === context.media.source?.timeline &&
        s.edition === context.media.source?.edition &&
        (!context.tracks.audio || s.audioTrackId === context.tracks.audio),
    );
    if (!source) {
      const pending = context.session.current?.onDemandSources?.find(
        (s) => !context.recovery.attempted.has(s.id),
      );
      if (pending && context.session.current?.serverControlled) {
        context.recovery.attempted.add(pending.id);
        requestSwitch(context, pending, position, true);
        return;
      }
      failPlayback(context, { ...failure, message: readFailure ? 'The stream is still unavailable after reconnecting. Try again.' : failure.message, recoverable: true });
      return;
    }
    // Release the guard before activation so a failed replacement can advance again.
    context.recovery.active = false;
    if (context.session.current?.serverControlled) requestSwitch(context, source, position, true);
    else await activateSource(context, source, position, true);
  } catch (e) {
    if (context.session.controller.current(token))
      failPlayback(context, { kind, message: String(e), recoverable: false });
  } finally {
    context.recovery.active = false;
  }
}

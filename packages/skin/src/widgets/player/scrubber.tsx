// The timeline: buffered ranges, the played fill, chapter marks and a thumb. Dragging (pointer
// or touch) moves the thumb at once and seeks on release; the thumb stays where it was let go
// until the engine's position catches up, so it never jumps back. On TV the focused timeline
// takes left and right as ten-second steps and seeks when the presses stop. On the web the
// timeline is a focusable slider: the arrows step ten seconds (the chrome's shortcuts), Page Up and
// Page Down a minute, Home and End go to the start and the end. A bubble over the thumb shows the
// target time and, once a session offers trickplay, its frame: while dragging, and on TV while the
// remote steps and until the picture gets there.
import type { TrickplayFrame } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Platform, Text, View, type GestureResponderEvent } from 'react-native';
import { msg } from '@vela/core';
import type { PlayerChromeState } from './context';
import { playerUsesHandheldGeometry, type PlayerLook } from './look';
import { bubbleLeft, scrubberReach, timecode, type PlayerView } from './present';
import { pressed, useRemote } from './remote';
import { useFocusClaim } from '../common/focus-claim';

const STEP_SECONDS = 10;
const PAGE_SECONDS = 60;
/** TV: the presses stop for this long, then the timeline seeks. */
const SETTLE_MS = 650;
/** A released target is held until the engine reports a position this close, or this long passes. */
const CAUGHT_UP_SECONDS = 1.5;
const HOLD_MS = 5000;

interface Props {
  look: PlayerLook;
  view: PlayerView;
  disabled: boolean;
  onSeek(seconds: number): void;
  /** Dragging or stepping: the chrome stays up meanwhile. */
  onActive(active: boolean): void;
  thumbnail?: PlayerChromeState['thumbnail'];
  /** TV: take focus as the chrome comes up (after a step from the remote). */
  preferred?: boolean;
  /** The target of a step the chrome took a moment ago, not yet reported by the engine. */
  stepFrom?(): number | null;
  /** A live rewind window: how a point reads (its distance behind live), and the live edge marked at the end. */
  live?: { label(seconds: number): string; color: string; atEdge: boolean };
}

export function Scrubber({ look, view, disabled, onSeek, onActive, thumbnail, preferred, stepFrom, live }: Props) {
  const say = (seconds: number) => (live ? live.label(seconds) : timecode(seconds));
  const claim = useFocusClaim(preferred);
  const box = useRef<ComponentRef<typeof View>>(null);
  const frame = useRef({ left: 0, width: 1 });
  const [target, setTarget] = useState<number | null>(null);
  const [held, setHeld] = useState<{ seconds: number; at: number } | null>(null);
  const [focused, setFocused] = useState(false);
  /** The timeline's width, so the bubble can stay over it at either end. */
  const [trackWidth, setTrackWidth] = useState(0);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const duration = view.duration;

  // Let go of a released target once the engine is there (or has had its chance).
  useEffect(() => {
    if (!held) return;
    if (Math.abs(view.position - held.seconds) < CAUGHT_UP_SECONDS) setHeld(null);
    const timer = setTimeout(() => setHeld(null), Math.max(0, held.at + HOLD_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [held, view.position]);

  useEffect(() => () => clearTimeout(settle.current), []);

  const commit = (seconds: number) => {
    const clamped = Math.max(0, Math.min(duration, seconds));
    setTarget(null);
    setHeld({ seconds: clamped, at: Date.now() });
    onActive(false);
    onSeek(clamped);
  };

  /** Where the timeline sits in the window, kept current so a quick click needs no measuring. */
  const measure = () => {
    box.current?.measureInWindow((left, _top, width) => {
      frame.current = { left, width };
    });
  };

  const fromEvent = (event: GestureResponderEvent) => {
    const { left, width } = frame.current;
    return Math.max(0, Math.min(1, (event.nativeEvent.pageX - left) / Math.max(1, width))) * duration;
  };

  const grant = (event: GestureResponderEvent) => {
    onActive(true);
    setTarget(fromEvent(event));
    measure();
  };

  /** Web keys on the focused timeline; the arrows are the chrome's own shortcuts. */
  const keys =
    Platform.OS === 'web'
      ? {
          onKeyDown: (event: { nativeEvent: object; preventDefault(): void }) => {
            if (disabled || duration <= 0) return;
            const key = (event.nativeEvent as { key?: string }).key;
            const from = held?.seconds ?? view.position;
            const to =
              key === 'Home'
                ? 0
                : key === 'End'
                  ? duration
                  : key === 'PageUp'
                    ? from + PAGE_SECONDS
                    : key === 'PageDown'
                      ? from - PAGE_SECONDS
                      : null;
            if (to === null) return;
            event.preventDefault();
            commit(to);
          },
        }
      : {};

  useRemote(event => {
    if (!focused || disabled) return;
    if (event.eventType !== 'left' && event.eventType !== 'right') return;
    if (!pressed(event)) return;
    const from = target ?? held?.seconds ?? stepFrom?.() ?? view.position;
    const next = Math.max(0, Math.min(duration, from + (event.eventType === 'right' ? STEP_SECONDS : -STEP_SECONDS)));
    onActive(true);
    setTarget(next);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => commit(next), SETTLE_MS);
  });

  const shown = target ?? held?.seconds ?? view.position;
  const fraction = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0;
  const active = target !== null;
  // The bubble: the drag or step target, and on TV where a step landed until the engine is there.
  const preview = target ?? (look.tv && focused ? held?.seconds ?? stepFrom?.() ?? null : null);
  const previewFraction = preview !== null && duration > 0 ? Math.max(0, Math.min(1, preview / duration)) : fraction;
  const bar = look.size(active || focused ? 6 : 4);
  const thumb = look.size(14);
  const height = look.size(look.tv ? 30 : 22);
  // On a phone or touch screen the timeline takes touches beyond its drawn row (44 points in
  // all, over the clock row below). Its bottom margin and its wrapper's top margin (in bars.tsx)
  // keep the layout as it was, and the wrapper contains the whole target.
  const reach = scrubberReach(look.tv, playerUsesHandheldGeometry());
  const still = preview !== null && thumbnail ? thumbnail(preview) : null;
  // The last frame drawn stays mounted (unseen) between previews, so its sheet, a large image, is
  // decoded once rather than each time the bubble comes up.
  const lastStill = useRef<TrickplayFrame | null>(null);
  if (still) lastStill.current = still;
  const kept = still ?? lastStill.current;
  const bubbleWidth = look.size(still ? (look.tv ? 240 : 176) : 72);
  return (
    <View
      ref={box}
      onLayout={event => {
        setTrackWidth(event.nativeEvent.layout.width);
        measure();
      }}
      style={{
        height: height + reach.above + reach.below,
        justifyContent: 'center',
        ...(reach.above || reach.below ? { marginBottom: -reach.below, zIndex: 1 } : {}),
      }}
      onStartShouldSetResponderCapture={() => !disabled && duration > 0}
      onMoveShouldSetResponderCapture={() => !disabled && duration > 0}
      onResponderTerminationRequest={() => false}
      onResponderGrant={grant}
      onResponderMove={event => setTarget(fromEvent(event))}
      onResponderRelease={event => commit(fromEvent(event))}
      onResponderTerminate={() => {
        setTarget(null);
        onActive(false);
      }}
    >
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={msg('ui.playbackPosition')}
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown), text: say(shown) }}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={say(shown)}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e =>
          commit(shown + (e.nativeEvent.actionName === 'increment' ? STEP_SECONDS : -STEP_SECONDS))
        }
        disabled={disabled || duration <= 0}
        focusable={(look.tv || Platform.OS === 'web') && !disabled && duration > 0}
        testID="player-scrub"
        hasTVPreferredFocus={claim}
        {...(Platform.OS === 'web' ? { dataSet: { velaFocus: 'timeline' } } : {})}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (target !== null) commit(target);
        }}
        onPress={() => {
          if (target !== null) {
            clearTimeout(settle.current);
            commit(target);
          }
        }}
        style={{ position: 'absolute', left: 0, right: 0, top: reach.above, bottom: reach.below, justifyContent: 'center' }}
        {...keys}
      >
        <View style={{ height: bar, borderRadius: bar / 2, backgroundColor: live ? look.trackStrong : look.track, overflow: 'hidden' }}>
          {view.buffered.map((range, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${range.start * 100}%`,
                width: `${Math.max(0, range.end - range.start) * 100}%`,
                backgroundColor: look.trackStrong,
              }}
            />
          ))}
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${fraction * 100}%`,
              backgroundColor: live || (focused && look.tv) ? look.accent : look.ink,
            }}
          />
        </View>
        {view.chapters
          .filter(c => c.at > 0)
          .map(chapter => (
            <View
              key={chapter.id}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: `${chapter.at * 100}%`,
                width: 2,
                height: bar,
                backgroundColor: look.page,
                opacity: 0.7,
              }}
            />
          ))}
        {live ? (
          // The live edge: a dot at the end of the window, lit while the picture is there.
          <View
            pointerEvents="none"
            testID="player-live-edge"
            style={{
              position: 'absolute', right: -look.size(4), width: look.size(8), height: look.size(8), borderRadius: look.size(4),
              backgroundColor: live.atEdge ? live.color : look.track, borderWidth: 1.5, borderColor: live.color,
            }}
          />
        ) : null}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${fraction * 100}%`,
            marginLeft: -thumb / 2,
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
            backgroundColor: look.ink,
            transform: [{ scale: active || focused || look.still ? 1 : 0.85 }],
            boxShadow:
              active || focused ? `0px 0px 0px ${look.size(6)}px ${look.focusHalo}` : `0px 2px 10px ${look.shadow}`,
          }}
        />
      </Pressable>
      {preview !== null || kept ? (
        // One bubble, kept mounted while there is a frame to keep, unseen between previews.
        <View
          pointerEvents="none"
          testID={preview !== null ? 'player-scrub-bubble' : undefined}
          style={{
            position: 'absolute',
            // The live delay notice occupies the strip directly above the track.
            bottom: reach.below + height + look.size(live ? 38 : 8),
            // Centred over the target, but kept over the timeline near either end.
            left: bubbleLeft(previewFraction, trackWidth, bubbleWidth),
            width: bubbleWidth,
            alignItems: 'center',
            gap: look.size(6),
            opacity: preview !== null ? 1 : 0,
          }}
        >
          {kept ? (
            <View style={still ? undefined : { position: 'absolute', opacity: 0 }}>
              <FramePreview frame={kept} width={look.size(look.tv ? 240 : 176)} radius={look.size(8)} background={look.raised} />
            </View>
          ) : null}
          {preview !== null ? (
            <Text
              style={[
                look.text(13, 600),
                {
                  paddingHorizontal: look.size(8),
                  paddingVertical: look.size(3),
                  borderRadius: look.size(6),
                  backgroundColor: look.popover,
                  fontVariant: ['tabular-nums'],
                  overflow: 'hidden',
                },
              ]}
            >
              {say(preview)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One thumbnail of a trickplay sheet: the whole sheet drawn at scale, moved so that only the
 * frame's cell shows through a window the thumbnail's shape. */
function FramePreview({ frame, width, radius, background }: { frame: TrickplayFrame; width: number; radius: number; background: string }) {
  const height = (width * frame.height) / frame.width;
  // One source object per sheet, so a re-render never hands the image a new (large) source.
  const source = useMemo(() => ({ uri: frame.uri }), [frame.uri]);
  return (
    <View testID="player-scrub-frame" style={{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: background }}>
      <Image
        source={source}
        contentFit="fill"
        cachePolicy="memory"
        transition={0}
        style={{
          position: 'absolute',
          width: width * frame.columns,
          height: height * frame.rows,
          left: -frame.column * width,
          top: -frame.row * height,
        }}
      />
    </View>
  );
}

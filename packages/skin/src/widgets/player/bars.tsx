// The chrome's two bars over gradients that fade into the picture: the top bar (close, and
// what is playing) and the bottom bar (a refused command, the chapter strip, the timeline,
// the clock, then icon transport and the screening controls with their menus). Both slide
// and fade with the chrome's visibility.
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo, useRef, type ComponentRef, type ReactNode } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { msg, time } from '@vela/core';
import { easing } from '../../motion';
import { ChromeButton } from './button';
import { ChapterStrip } from './chapters';
import { LiveDial, LiveMark, LiveMultiview, LiveStatusLine, LiveZap, type LiveWatch } from './live';
import type { CommandInput, PlayerChromeState } from './context';
import type { OverlaySwitch } from '../../surfaces/player';
import { playerUsesHandheldGeometry, type PlayerLook } from './look';
import { PHONE_CONTROL_GAP, PHONE_PLAY_WIDTH } from './phone-layout';
import { MenuAction, MenuPanel } from './menu';
import { AudioMenu, qualityMenuRows, SleepMenu, SpeedMenu, SubtitlesMenu, type MenuName } from './menus';
import { scrubberReach, type PlayerView } from './present';
import { sameControls } from './steady-controls';
import { Scrubber } from './scrubber';
import { Volume } from './volume';
import type { Focusable } from '../../escape';
import type { PlayerIconName } from './icons';
import { useMultiview } from '../multiview/context';
import { PLAYER_CHROME_TRANSITION_MS } from './idle';

/** TV: focus to a control once the one it replaces has left the tree. */
function focusLater(target: { current: Focusable | null }): void {
  if (!Platform.isTV) return;
  requestAnimationFrame(() => target.current?.requestTVFocus?.());
}

export type Opened = MenuName | 'chapters' | 'more' | null;
/** Where a TV chrome's focus lands as it comes up. */
export type Reveal = 'toggle' | 'timeline';

/** `#rrggbb[aa]` with no alpha, so a gradient fades in the colour itself rather than through black. */
function clear(colour: string): string {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(colour);
  return hex ? `#${hex[1]}00` : 'transparent';
}

// UIKit must be able to focus the controls in the same commit that removes the hidden
// picture target. An animated bar can still be moving when requestTVFocus is processed.
function shownStyle(look: PlayerLook, visible: boolean, from: number): ViewStyle {
  return {
    opacity: visible ? 1 : 0,
    transform: [{ translateY: visible || look.still || look.tv ? 0 : from }],
    transitionProperty: ['opacity', 'transform'],
    transitionDuration: look.tv || look.still ? 0 : PLAYER_CHROME_TRANSITION_MS,
    // Native Reanimated takes a bezier only as cubicBezier(): easing() converts the CSS text.
    transitionTimingFunction: easing('cubic-bezier(0.16, 1, 0.3, 1)'),
  } as ViewStyle;
}

/** Hidden TV controls leave the native focus tree completely. A disabled focus guide around
 * a live row can retain a destination and send horizontal navigation back to that child. */
function FocusZone({ visible, children }: { visible: boolean; children: ReactNode }) {
  return Platform.isTV && !visible ? null : <>{children}</>;
}

interface TopProps {
  look: PlayerLook;
  title: string;
  visible: boolean;
  bleed?: ViewStyle;
  onClose(): void;
}

/** Drawn again only when its props change (not for the clock). */
export const TopBar = memo(function TopBar({ look, title, visible, bleed, onClose }: TopProps) {
  const fade = look.small ? (look.short ? 44 : 72) : look.size(140);
  // The same style object while nothing changes: Reanimated compares and re-applies a new one each redraw.
  const shown = useMemo(() => shownStyle(look, visible, -14), [look, visible]);
  return (
    <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={shown}>
      <LinearGradient
        colors={[look.scrim, look.scrim, clear(look.scrim)]}
        locations={[0, 0.55, 1]}
        style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, bleed]}
        pointerEvents="none"
      />
      <FocusZone visible={visible}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: look.size(look.small ? 14 : 20),
            paddingTop: look.small ? (look.short ? 4 : 18) : look.size(30),
            paddingHorizontal: look.gutter,
            paddingBottom: fade,
          }}
        >
          <ChromeButton
            look={look}
            icon="back"
            label={msg('ui.closePlayer')}
            size={46}
            onPress={onClose}
            testID="player-close"
          />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text
              style={[look.text(10, 650, look.inkQuiet), { letterSpacing: look.size(1.4), textTransform: 'uppercase' }]}
            >
              {msg('ui.nowPlaying')}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                look.display(look.small ? 24 : 34),
                { textShadowColor: look.shadow, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 18 },
              ]}
            >
              {title}
            </Text>
          </View>
        </View>
      </FocusZone>
    </Animated.View>
  );
});

interface BottomProps {
  look: PlayerLook;
  state: PlayerChromeState;
  view: PlayerView;
  visible: boolean;
  reveal: Reveal;
  /** The target of a step taken a moment ago, which the engine has yet to report. */
  stepFrom(): number | null;
  blocked: boolean;
  opened: Opened;
  presentPanel: boolean;
  info: boolean;
  menuHeight: number;
  onMenuLayout(width: number, height: number): void;
  onRowLayout(height: number): void;
  bleed?: ViewStyle;
  send(command: CommandInput): void;
  seek(seconds: number): void;
  seekBy(seconds: number): void;
  toggle(menu: Exclude<Opened, null>): void;
  closeMenu(): void;
  toggleInfo(): void;
  onActive(active: boolean): void;
  live: LiveWatch;
  /** A plugin overlay the viewer toggles from the chrome (the scores ticker): its button. */
  overlay?: TickerToggle;
  /** Plugin overlays that apply here, each with its switch (the subtitles menu lists them). */
  overlaySwitches?: OverlaySwitch[];
}

/** The chrome's button for a `toggle` player overlay (surfaces/player.tsx). */
export interface TickerToggle { available: boolean; ticker: boolean; toggleTicker(): void; /** The overlay's name (its setting's label). */ label: string }

export const bottomFade = (look: PlayerLook) => look.small ? (look.short ? 48 : 80) : look.size(150);

export function BottomBar(props: BottomProps) {
  const { look, state, view, visible, blocked, opened, bleed } = props;
  const fade = bottomFade(look);
  const reach = scrubberReach(look.tv, playerUsesHandheldGeometry());
  const shown = useMemo(() => shownStyle(look, visible, 18), [look, visible]);
  return (
    <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={shown}>
      <LinearGradient
        colors={[clear(look.scrim), look.scrim, look.scrim]}
        locations={[0, 0.45, 1]}
        style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, bleed]}
        pointerEvents="none"
      />
      <FocusZone visible={visible}>
        <View
          style={{
            paddingTop: fade,
            paddingHorizontal: look.gutter,
            paddingBottom: look.small ? (look.short ? 6 : 18) : look.size(30),
            gap: look.size(look.small ? 10 : 14),
          }}
        >
          {state.actionError && !state.failure ? (
            <Text accessibilityRole="alert" style={look.text(13, 500, look.accent)}>
              {state.actionError}
            </Text>
          ) : null}
          {Platform.OS === 'web' && !look.small && opened === 'chapters' && view.chapters.length ? (
            <ChapterStrip look={look} view={view} disabled={blocked} onSeek={props.seek} />
          ) : null}
          {props.live.live ? (
            <View
              style={{
                alignItems: look.small || props.live.window?.seekable ? 'stretch' : 'flex-start',
                gap: look.size(10),
                // The timeline wrapper starts 10 pt above the drawn row. This padding keeps it inside
                // the live group even when it comes first.
                ...(props.live.window?.seekable && reach.above ? { paddingTop: reach.above, marginTop: -reach.above } : {}),
              }}
            >
              <LiveDial channelId={props.live.channelId} small={look.small} still={look.still} />
              <LiveStatusLine look={look} watch={props.live} />
              {look.small && !props.live.window?.seekable && !props.live.archive && props.live.behind <= 0
                ? <LiveMark look={look} watch={props.live} /> : null}
              {props.live.window?.seekable ? <LiveTimeline {...props} /> : null}
            </View>
          ) : (
            <Timeline {...props} />
          )}
          <SteadyControls {...props} />
        </View>
      </FocusZone>
    </Animated.View>
  );
}

/** The timeline and the clock under it. */
function Timeline({ look, state, view, blocked, seek, onActive, visible, reveal, stepFrom }: BottomProps) {
  const reach = scrubberReach(look.tv, playerUsesHandheldGeometry());
  return (
    <View style={reach.above ? { marginTop: -reach.above } : undefined}>
      <Scrubber
        look={look}
        view={view}
        preferred={Platform.isTV && visible && !blocked && reveal === 'timeline'}
        stepFrom={stepFrom}
        disabled={blocked}
        onSeek={seek}
        onActive={onActive}
        thumbnail={state.thumbnail}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[look.text(12, 400, look.inkSecondary), { fontVariant: ['tabular-nums'] }]}>{view.elapsed}</Text>
        <Text style={[look.text(12, 400, look.inkSecondary), { fontVariant: ['tabular-nums'] }]}>{view.remaining}</Text>
      </View>
    </View>
  );
}

/**
 * A channel's rewind window (or Start over's programme so far) as the timeline: the start's clock
 * time on the left and the live edge clock on the right.
 * Positions are the window's own; the scrubber works in seconds from its start.
 */
function LiveTimeline({ look, state, view, blocked, seek, onActive, visible, reveal, stepFrom, live }: BottomProps) {
  const window = live.window!;
  const span = Math.max(0, window.edge - window.start);
  const relative = { ...view, position: window.position - window.start, duration: span, buffered: [], chapters: [] };
  const startsAt = live.windowStartAt;
  const reach = scrubberReach(look.tv, playerUsesHandheldGeometry());
  return (
    <View testID="player-live-timeline" style={reach.above ? { marginTop: -reach.above } : undefined}>
      <Scrubber
        key={`${state.plan?.sessionId}:${state.plan?.sourceGeneration}`}
        look={look}
        view={relative}
        preferred={Platform.isTV && visible && !blocked && reveal === 'timeline'}
        stepFrom={() => { const from = stepFrom(); return from === null ? null : from - window.start; }}
        disabled={blocked}
        onSeek={seconds => seek(window.start + seconds)}
        onActive={onActive}
        live={{ label: seconds => time(startsAt + seconds * 1000), color: look.live, atEdge: !window.delayed && !window.startOver }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[look.text(12, 400, look.inkSecondary), { fontVariant: ['tabular-nums'] }]}>
          {live.archive === 'startOver' ? msg('catchUp.startOver') + ' · ' + time(startsAt) : time(startsAt)}
        </Text>
        <Text testID="player-live-edge-time" style={[look.text(12, window.delayed ? 600 : 700, window.delayed ? look.ink : look.live), { fontVariant: ['tabular-nums'] }]}>
          {time(live.windowEdgeAt)} · {msg('data.live')}
        </Text>
      </View>
    </View>
  );
}

const SteadyControls = memo(Controls, sameControls);

function Controls(props: BottomProps) {
  const {
    state,
    look,
    view,
    blocked,
    opened,
    info,
    menuHeight,
    send,
    seekBy,
    seek,
    toggle,
    closeMenu,
    toggleInfo,
    onActive,
    live,
    visible,
    reveal,
    overlay,
    overlaySwitches,
  } = props;
  // A channel plays at the live edge: channel up and down and the LIVE mark take the place of
  // the ten-second steps; no speed, no chapters. A rewind window brings the steps back.
  const timeline = !live.live;
  const rewind = live.live && !!live.window?.seekable;
  const gap = look.size(look.small ? PHONE_CONTROL_GAP : 8);
  const anchorRef = useRef<ComponentRef<typeof View>>(null);
  // Back to live leaves as it takes the picture to the edge (the LIVE mark is not a control): focus
  // goes to the play toggle, not wherever the engine finds next (the top bar's Close on Android TV).
  const toggleRef = useRef<Focusable | null>(null);
  const names: Record<Exclude<Opened, null>, string> = {
    subtitles: msg('ui.subtitles'),
    audio: msg('ui.audio'),
    quality: msg('ui.quality'),
    speed: msg('player.speed'),
    sleep: msg('player.sleep'),
    chapters: msg('ui.chapters'),
    more: msg('ui.playbackSettings'),
  };
  const menu = opened === 'chapters' && Platform.OS === 'web' && !look.small ? null : opened;
  const contents = (name: Exclude<Opened, null>): ReactNode => {
    switch (name) {
      case 'more':
        return <PhoneActions {...props} timeline={timeline} rewind={rewind} />;
      case 'chapters':
        return <ChapterStrip look={look} view={view} disabled={blocked} onSeek={seek} />;
      case 'subtitles':
        return <SubtitlesMenu look={look} view={view} blocked={blocked} send={send} overlays={overlaySwitches} />;
      case 'audio':
        return <AudioMenu look={look} view={view} blocked={blocked} send={send} />;
      case 'quality':
        return qualityMenuRows({
          look, view, plan: state.plan, blocked, send, switchVersion: state.switchVersion,
          pendingVersionId: state.pendingVersionId, versionMessage: state.versionMessage,
          pendingQualityId: state.pendingQualityId, info, onInfo: toggleInfo, streaming: state.streaming,
        });
      case 'speed':
        return <SpeedMenu look={look} view={view} blocked={blocked} send={send} />;
      case 'sleep':
        return state.sleep ? <SleepMenu look={look} sleep={state.sleep} episode={!!state.episode} /> : null;
    }
  };
  const cluster: ViewStyle = { flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'flex-end', gap };
  const panel = menu && props.presentPanel ? (
    <MenuPanel look={look} name={names[menu]} maxHeight={menuHeight} wide={menu === 'quality' && !!state.plan?.versions?.length} anchorRef={anchorRef} onClose={closeMenu} onPanelLayout={props.onMenuLayout}>
      {contents(menu)}
    </MenuPanel>
  ) : null;
  // Each TV button is a native focus destination. The play toggle claims focus once on reveal.
  const play = (
    <ChromeButton
      key={Platform.isTV && visible && !blocked ? 'focus-ready' : 'inactive'}
      look={look}
      primary
      preferred={Platform.isTV && visible && !blocked && (reveal === 'toggle' || (!timeline && !rewind))}
      icon={view.playing ? 'pause' : 'play'}
      label={view.ended ? msg('ui.finished') : view.playing ? msg('ui.pause') : msg('ui.play')}
      disabled={blocked}
      size={look.small ? PHONE_PLAY_WIDTH : 52}
      testID="player-toggle"
      buttonRef={toggleRef}
      onPress={() => { if (view.playing) live.leftLive(); send({ type: view.playing ? 'pause' : 'play' }); }}
    />
  );
  const steps = (
    <>
      <ChromeButton
        look={look}
        icon="skipBack"
        label={msg('ui.back10Seconds')}
        disabled={blocked}
        testID="player-back-10"
        onPress={() => seekBy(-10)}
      />
      <ChromeButton
        look={look}
        icon="skipForward"
        label={msg('ui.forward10Seconds')}
        disabled={blocked || (rewind ? !live.window?.delayed && !live.window?.startOver : view.duration <= 0)}
        testID="player-forward-10"
        onPress={() => seekBy(10)}
      />
    </>
  );
  const captions = (
    <ChromeButton look={look} icon={view.subtitleId ? 'captionsOn' : 'captions'}
      compact label={names.subtitles} selected={opened === 'subtitles'}
      testID="player-cc-button" onPress={() => toggle('subtitles')} />
  );
  const volume = <Volume look={look} view={view} send={send} onActive={onActive} />;
  const channels = <LiveZap look={look} watch={live} disabled={!live.canZap} />;
  if (look.small) {
    return (
      <View ref={anchorRef} collapsable={false} onLayout={event => props.onRowLayout(event.nativeEvent.layout.height)} testID="player-phone-controls"
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
          {play}
          {look.showSteps ? (timeline || rewind ? steps : channels) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
          {volume}
          {captions}
          <ChromeButton look={look} icon="more" compact label={names.more} selected={opened === 'more'}
            testID="player-more-button" onPress={() => toggle('more')} />
        </View>
        {panel}
      </View>
    );
  }
  return (
    <View ref={anchorRef} collapsable={false} onLayout={event => props.onRowLayout(event.nativeEvent.layout.height)} style={{ flexDirection: 'row', alignItems: 'center', gap }}>
      {play}
      {timeline || rewind ? steps : null}
      {timeline ? <ChromeButton look={look} icon="restart" label={msg('ui.startOver')}
        disabled={blocked} testID="player-start-over" onPress={() => seek(0)} /> : null}
      {/* An episode's next one, at any time, and after it ends (where it takes TV focus). */}
      {timeline && state.nextEpisode ? <ChromeButton look={look} icon="next" label={msg('player.nextEpisodeNamed', { name: state.nextEpisode.label })}
        preferred={Platform.isTV && visible && view.ended} testID="player-next-episode" onPress={state.nextEpisode.play} /> : null}
      {/* On a channel: the programme on air from its start (its start is in the archive); in Start over, back to its beginning. */}
      {!timeline && live.archive === 'startOver' && live.window ? <ChromeButton look={look} icon="restart" label={msg('ui.startOver')}
        disabled={blocked} testID="player-start-over" onPress={() => seek(live.window!.start)} /> : null}
      {!timeline && !live.archive && live.startOver ? <ChromeButton look={look} icon="restart" text={msg('catchUp.startOver')} label={msg('catchUp.startOver')}
        disabled={blocked} testID="player-start-over" onPress={live.startOver} /> : null}
      {timeline ? null : channels}
      {timeline || live.archive ? null : <LiveMultiview look={look} watch={live} />}
      {volume}
      {timeline && live.archive !== 'catchUp' ? null : <LiveMark look={look} watch={live} onLeave={() => focusLater(toggleRef)} />}
      <View style={cluster}>
        <Text
          numberOfLines={1}
          testID="player-quality"
          style={[
            look.text(11, 600, look.inkSecondary),
            {
              alignSelf: 'center',
              flexShrink: 1,
              letterSpacing: look.size(0.4),
              paddingHorizontal: look.size(10),
              paddingVertical: look.size(4),
              borderWidth: 1,
              borderColor: look.glassEdge,
              borderRadius: look.size(6),
              marginRight: look.size(6),
            },
          ]}
        >
          {view.quality || view.path}
        </Text>
        {!timeline && overlay?.available ? (
          <ChromeButton
            look={look}
            icon={overlay.ticker ? 'tickerOn' : 'ticker'}
            compact
            label={msg(overlay.ticker ? 'player.hideOverlay' : 'player.showOverlay', { name: overlay.label })}
            selected={overlay.ticker}
            testID="player-ticker-button"
            onPress={overlay.toggleTicker}
          />
        ) : null}
        {captions}
        <ChromeButton
          look={look}
          icon="audio"
          compact
          label={names.audio}
          selected={opened === 'audio'}
          testID="player-audio-button"
          onPress={() => toggle('audio')}
        />
        <ChromeButton
          look={look}
          icon="quality"
          compact
          label={names.quality}
          selected={opened === 'quality'}
          testID="player-quality-button"
          onPress={() => toggle('quality')}
        />
        {timeline ? (
          <>
            <ChromeButton
              look={look}
              icon="speed"
              compact
              label={names.speed}
              selected={opened === 'speed'}
              testID="player-speed-button"
              onPress={() => toggle('speed')}
            />
            <ChromeButton
              look={look}
              icon="chapters"
              compact
              label={msg('ui.chapters')}
              selected={opened === 'chapters'}
              disabled={!view.chapters.length}
              testID="player-chapters-button"
              onPress={() => toggle('chapters')}
            />
            {state.sleep ? (
              <ChromeButton
                look={look}
                icon="moon"
                compact
                label={names.sleep}
                selected={opened === 'sleep' || state.sleep.value.mode !== 'off'}
                testID="player-sleep-button"
                onPress={() => toggle('sleep')}
              />
            ) : null}
          </>
        ) : null}
        {state.picture ? (
          <ChromeButton
            look={look}
            icon={state.picture.fill ? 'pictureFill' : 'pictureFit'}
            compact
            label={msg(state.picture.fill ? 'player.picture.fit' : 'player.picture.fill')}
            selected={state.picture.fill}
            testID="player-picture-button"
            onPress={() => state.picture?.set(!state.picture.fill)}
          />
        ) : null}
        {view.pip ? (
          <ChromeButton
            look={look}
            icon="pip"
            compact
            label={msg('ui.pictureInPicture')}
            onPress={() => send({ type: 'pip' })}
          />
        ) : null}
        {view.fullscreen ? (
          <ChromeButton
            look={look}
            icon="fullscreen"
            compact
            label={msg('ui.fullscreen')}
            onPress={() => send({ type: 'fullscreen' })}
          />
        ) : null}
      </View>
      {panel}
    </View>
  );
}

function PhoneActions({ look, state, view, blocked, live, overlay, seek, seekBy, send, toggle, closeMenu, timeline, rewind }: BottomProps & {
  timeline: boolean;
  rewind: boolean;
}) {
  const multiview = useMultiview();
  const action = (icon: PlayerIconName, label: string, testID: string, onPress: () => void, disabled = false) => (
    <MenuAction look={look} icon={icon} label={label} testID={testID} disabled={disabled}
      onPress={() => { closeMenu(); onPress(); }} />
  );
  const submenu = (icon: PlayerIconName, label: string, id: Exclude<Opened, null>, testID: string, disabled = false) => (
    <MenuAction look={look} icon={icon} label={label} testID={testID} disabled={disabled} onPress={() => toggle(id)} />
  );
  const atStart = live.archive === 'startOver' && live.window?.start;
  return (
    <>
      {!look.showSteps && (timeline || rewind) ? <>
        {action('skipBack', msg('ui.back10Seconds'), 'player-back-10', () => seekBy(-10), blocked)}
        {action('skipForward', msg('ui.forward10Seconds'), 'player-forward-10', () => seekBy(10),
          blocked || (rewind ? !live.window?.delayed && !live.window?.startOver : view.duration <= 0))}
      </> : null}
      {!timeline && (rewind || !look.showSteps) ? <>
        {action('channelUp', msg('live.channelUp'), 'player-channel-up', () => live.zap(-1), !live.canZap)}
        {action('channelDown', msg('live.channelDown'), 'player-channel-down', () => live.zap(1), !live.canZap)}
      </> : null}
      {timeline || typeof atStart === 'number' ? action('restart', msg('ui.startOver'), 'player-start-over',
        () => seek(typeof atStart === 'number' ? atStart : 0), blocked) : null}
      {!timeline && !live.archive && live.startOver ? action('restart', msg('catchUp.startOver'), 'player-start-over', live.startOver, blocked) : null}
      {timeline && state.nextEpisode ? action('next', msg('player.nextEpisodeNamed', { name: state.nextEpisode.label }),
        'player-next-episode', state.nextEpisode.play) : null}
      {!(live.window?.delayed && live.window.seekable) && (live.live || live.archive === 'catchUp') && (live.behind > 0 || live.archive || (live.paused && !!live.window?.seekable))
        ? action('live', msg('catchUp.backToLive'), 'player-go-live', live.backToLive) : null}
      {!timeline && !live.archive && multiview && live.channelId ? action('tiles', msg('multiview.add'), 'player-multiview',
        () => multiview.open(live.channelId, { replace: true })) : null}
      {!timeline && overlay?.available ? action(overlay.ticker ? 'tickerOn' : 'ticker',
        msg(overlay.ticker ? 'player.hideOverlay' : 'player.showOverlay', { name: overlay.label }), 'player-ticker-button', overlay.toggleTicker) : null}
      {submenu('audio', msg('ui.audio'), 'audio', 'player-audio-button')}
      {submenu('quality', msg('ui.quality'), 'quality', 'player-quality-button')}
      {timeline ? <>
        {submenu('speed', msg('player.speed'), 'speed', 'player-speed-button')}
        {submenu('chapters', msg('ui.chapters'), 'chapters', 'player-chapters-button', !view.chapters.length)}
        {state.sleep ? submenu('moon', msg('player.sleep'), 'sleep', 'player-sleep-button') : null}
      </> : null}
      {state.picture ? action(state.picture.fill ? 'pictureFill' : 'pictureFit',
        msg(state.picture.fill ? 'player.picture.fit' : 'player.picture.fill'), 'player-picture-button',
        () => state.picture?.set(!state.picture.fill)) : null}
      {view.pip ? action('pip', msg('ui.pictureInPicture'), 'player-pip-button', () => send({ type: 'pip' })) : null}
      {view.fullscreen ? action('fullscreen', msg('ui.fullscreen'), 'player-fullscreen-button', () => send({ type: 'fullscreen' })) : null}
    </>
  );
}

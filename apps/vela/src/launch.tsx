// The first launch stands above every skin, then dissolves and unmounts for good.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useReducedMotion, type CSSAnimationProperties } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LaunchArt } from './launch-art';
import { launchDelay, type LaunchStage } from './launch-state';

const fadeIn = { from: { opacity: 0 }, to: { opacity: 1 } };
const fadeOut = { from: { opacity: 1 }, to: { opacity: 0 } };
function fade(out: boolean, duration: number): CSSAnimationProperties {
  return { animationName: out ? fadeOut : fadeIn, animationDuration: duration, animationTimingFunction: 'ease-out', animationFillMode: 'both' };
}
interface LaunchBranding { name?: string; wordmark?: { url: string; dark?: string } }

export function LaunchGate({ ready, brandingReady, branding, children }: { ready: boolean; brandingReady: boolean; branding?: LaunchBranding; children: ReactNode }) {
  const still = useReducedMotion();
  const [stage, setStage] = useState<LaunchStage>('intro');
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (ready) setArmed(true); }, [ready]);
  const visible = stage !== 'done';
  const duration = still ? 160 : 420;
  return <View style={styles.root}>
    <Animated.View pointerEvents={visible ? 'none' : 'auto'} accessibilityElementsHidden={visible}
      importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}
      style={[styles.root, { opacity: visible ? 0 : 1 }, stage === 'exit' && fade(false, duration)]}>
      {children}
    </Animated.View>
    {visible && <LaunchCover ready={armed} still={still} brandingReady={brandingReady} branding={branding} exiting={stage === 'exit'} duration={duration}
      onExit={() => setStage('exit')} onDone={() => setStage('done')} />}
  </View>;
}
function LaunchCover({ ready, still, brandingReady, branding, exiting, duration, onExit, onDone }: { ready: boolean; still: boolean; brandingReady: boolean; branding?: LaunchBranding; exiting: boolean; duration: number; onExit(): void; onDone(): void }) {
  const { width, height } = useWindowDimensions();
  const started = useRef(Date.now());
  const callbacks = useRef({ onExit, onDone });
  callbacks.current = { onExit, onDone };
  useEffect(() => {
    if (!ready) return;
    const delay = launchDelay(Date.now() - started.current, still || !!branding);
    const exit = setTimeout(() => callbacks.current.onExit(), delay);
    const done = setTimeout(() => callbacks.current.onDone(), delay + duration);
    return () => { clearTimeout(exit); clearTimeout(done); };
  }, [ready, still, branding, duration]);
  const wordmark = branding?.wordmark?.dark || branding?.wordmark?.url;
  const label = branding?.name || 'Vela';
  return <Animated.View testID="vela-launch" accessibilityRole="progressbar" accessibilityLabel={`${label} is loading`}
    accessibilityViewIsModal style={[styles.cover, exiting && fade(true, duration)]}>
    {Platform.OS === 'web' ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundImage: 'radial-gradient(ellipse 60% 55% at 50% 46%, rgba(220,185,152,.10) 0%, rgba(9,11,14,0) 70%)' }]} /> : <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs><RadialGradient id="launch-lift" gradientUnits="userSpaceOnUse" cx={width * 0.5} cy={height * 0.46} rx={width * 0.6} ry={height * 0.55}>
        <Stop offset="0" stopColor="#dcb998" stopOpacity={0.1}/><Stop offset="0.7" stopColor="#dcb998" stopOpacity={0}/>
      </RadialGradient></Defs><Rect width="100%" height="100%" fill="url(#launch-lift)"/>
    </Svg>}
    {!brandingReady ? null : wordmark
      ? <Image source={{ uri: wordmark }} contentFit="contain" style={styles.wordmark} accessibilityElementsHidden />
      : branding?.name
        ? <Text style={styles.name} accessibilityElementsHidden>{branding.name}</Text>
        : <LaunchArt width={width} height={height} still={still}/>}
  </Animated.View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: { ...StyleSheet.absoluteFill, zIndex: 10000, backgroundColor: '#090b0e', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  wordmark: { width: '62%', maxWidth: 420, height: 120 },
  name: { color: '#f5f1e9', fontSize: 38, fontWeight: '700', textAlign: 'center', paddingHorizontal: 24 },
});

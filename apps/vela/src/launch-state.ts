/** Launch is a one-way latch, independent of routes, refreshes and later sign-ins. */
export type LaunchStage = 'intro' | 'exit' | 'done';
export const LAUNCH_BUILD_MS = 2260 + 260; // The final letter has finished lighting.
export function launchDelay(elapsed: number, still: boolean): number {
  return Math.max(0, (still ? 0 : LAUNCH_BUILD_MS) - elapsed);
}
export { searchlightGeometry } from '@vela/skin/src/widgets/common/searchlight-geometry';
export function launchReady(phase: string, load: string, fonts: boolean, authRoute: boolean, docError: boolean, homeSlow = false, searching = false): boolean {
  return fonts && (docError || ((phase === 'signed-out' || phase === 'offline') && authRoute) ||
    (phase === 'signed-in' && (searching || load === 'ready' || load === 'failed' || homeSlow)));
}

/** The first completed load releases the route host. Subsequent loads keep it mounted and
 * advance the revision on completion so native text can pick up newly registered fonts. */
export function fontLoadRevision(revision: number, phase: 'loading' | 'settled'): number {
  return phase === 'settled' ? revision + 1 : revision;
}

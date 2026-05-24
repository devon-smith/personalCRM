/**
 * Tiny platform-detection helper for code paths that should behave
 * differently inside the Capacitor mobile shell.
 *
 * The Capacitor runtime sets window.Capacitor when the page loads inside
 * the native webview. In a normal browser tab it's undefined. Helpers
 * here are safe to call from SSR (they no-op when window isn't defined).
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => "ios" | "android" | "web";
}

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True when the app is loaded inside the Capacitor native shell. */
export function isMobileShell(): boolean {
  const cap = getCapacitor();
  return !!cap?.isNativePlatform?.();
}

/** "ios" | "android" | "web". Always "web" when not in the shell. */
export function getMobilePlatform(): "ios" | "android" | "web" {
  return getCapacitor()?.getPlatform?.() ?? "web";
}

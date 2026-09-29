/**
 * The address Expo Go opens to load the SmartNav Capture phone app, which
 * `start-demo.bat mobile` serves from this computer on port 8081.
 *
 * Order: VITE_EXPO_URL if set; else this page's host when it is a network
 * address (phones cannot reach "localhost"); else null.
 *
 * @param {{ hostname?: string }} [location] - defaults to window.location
 * @param {Record<string, string | undefined>} [env] - defaults to import.meta.env
 * @returns {string | null}
 */
export function expoGoUrl(location = typeof window !== 'undefined' ? window.location : {}, env = import.meta.env) {
  if (env.VITE_EXPO_URL) return env.VITE_EXPO_URL;
  const host = location?.hostname || '';
  if (!host || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)) return null;
  return `exp://${host}:${env.VITE_EXPO_PORT || '8081'}`;
}

// Where the UI reaches the gateway. In a browser tab the page is served by the
// gateway, so its own origin is the API; the desktop window is served by the
// Wails asset server instead and reaches the gateway on its local port.
// The host bridge (@/host) says which case applies.
import { host } from '@/host';

/**
 * Get the base URL for API calls
 * - Desktop: http://localhost:{port} of the in-process gateway
 * - Browser: {protocol}//{host} of the page
 */
export async function getApiBaseUrl(): Promise<string> {
  const port = await host.gatewayPort();
  if (port !== null) {
    return `http://localhost:${port}`;
  }
  const origin = window.location.host.replace(/\/$/, '');
  return `${window.location.protocol}//${origin}`;
}

/**
 * Get the OAuth redirect URI for callback
 * - Desktop: http://localhost:{port}/oauth/callback (local callback)
 * - Browser: {origin}/oauth/callback
 */
export async function getOAuthRedirectPath(): Promise<string> {
  return `${await getApiBaseUrl()}/oauth/callback`;
}

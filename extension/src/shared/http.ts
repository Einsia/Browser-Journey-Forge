/**
 * Headers attached to every request to the ingestion endpoint.
 *
 * `ngrok-skip-browser-warning` bypasses the ngrok free-tier interstitial HTML
 * page that would otherwise be returned to browser User-Agents (breaking JSON
 * fetches). It is harmless to non-ngrok endpoints, which ignore the header.
 */
export const TUNNEL_BYPASS_HEADERS: Record<string, string> = {
  'ngrok-skip-browser-warning': 'true',
};

// Journey-Forge Local — product build flags.
//
// This extension is the consumer-product fork (journey-forge-local). It ships
// pre-pointed at the local server and hides the ClawBench task-queue UI. The
// research extension behavior is recovered by flipping PRODUCT_LOCAL to false.

export const PRODUCT_LOCAL = true;

// Default local ingestion server. Matches server/server.py's JFL_PORT (8099).
export const DEFAULT_ENDPOINT_URL = 'http://127.0.0.1:8099';

// Default Bearer key. The local server seeds this same key into api-keys.json
// on first run (see _load_api_keys / JFL_DEFAULT_KEY), so a freshly-loaded
// extension connects with zero configuration. Override in Settings if needed.
export const DEFAULT_API_KEY = 'jfl-local-dev-key';

// Tasks = the ClawBench claim/lease queue. Off in the product (free-form only).
export const SHOW_TASKS_UI = !PRODUCT_LOCAL;

// Identity bundles are a research concept; in the product, identity fetch is
// best-effort and must never block recording or upload.
export const IDENTITY_BEST_EFFORT = PRODUCT_LOCAL;

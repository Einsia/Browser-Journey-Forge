import type { IdentityBundle } from '@/shared/types';
import { TUNNEL_BYPASS_HEADERS } from '@/shared/http';

export async function requestIdentityBundle(opts: {
  endpointUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<IdentityBundle> {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      ...TUNNEL_BYPASS_HEADERS,
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ purpose: 'research_free_form' })
  };
  if (opts.signal) init.signal = opts.signal;

  const response = await fetch(`${opts.endpointUrl.replace(/\/+$/, '')}/v1/identity-bundles`, init);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`identity bundle request failed: ${response.status} ${text.slice(0, 160)}`);
  }

  return (await response.json()) as IdentityBundle;
}

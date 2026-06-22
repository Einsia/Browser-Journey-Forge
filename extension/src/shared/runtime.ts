import { browser } from 'wxt/browser';

/**
 * Thin typed wrapper over browser.runtime.sendMessage. Callers parameterize the
 * response type; the message keeps its own (per-sender) RuntimeMessage type.
 */
export async function sendRuntimeMessage<TResponse>(
  message: object
): Promise<TResponse> {
  return (await browser.runtime.sendMessage(message)) as TResponse;
}

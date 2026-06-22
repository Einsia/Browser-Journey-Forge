export function createId(prefix: string): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  const suffix = Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}${Date.now().toString(36)}_${suffix}`;
}

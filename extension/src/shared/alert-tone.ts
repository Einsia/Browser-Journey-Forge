export type AlertTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

/** Normalize a free-form notice tone into a supported Alert tone. */
export function alertTone(tone: string): AlertTone {
  if (tone === 'error') return 'danger';
  if (
    tone === 'info' ||
    tone === 'warning' ||
    tone === 'danger' ||
    tone === 'success'
  ) {
    return tone;
  }
  return 'neutral';
}

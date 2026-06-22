import { englishTranslator, type Translator } from '@/i18n';
import type { RecordingRow } from '@/shared/types';

/** Display label for a recording: its trimmed label, else a short id fallback. */
export function recordingLabel(
  recording: RecordingRow | undefined,
  tr: Translator = englishTranslator
): string {
  if (!recording) return tr('recording.unlabeled');
  return (
    recording.envelope.label?.trim() ||
    tr('recording.unlabeledWithId', { id: recording.trace_id.slice(0, 10) })
  );
}

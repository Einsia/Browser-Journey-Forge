import { englishTranslator, type Translator } from '@/i18n';

export type DeleteConfirmation = {
  title: string;
  detail: string;
  traceId: string;
  confirmLabel: string;
  cancelLabel: string;
};

export function deleteConfirmation(
  options: { label: string; traceId: string },
  tr: Translator = englishTranslator
): DeleteConfirmation {
  const subject = options.label.trim() || options.traceId;
  return {
    title: tr('delete.title'),
    detail: tr('delete.detail', { subject }),
    traceId: options.traceId,
    confirmLabel: tr('delete.confirm'),
    cancelLabel: tr('delete.cancel')
  };
}

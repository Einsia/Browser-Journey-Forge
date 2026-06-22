import { englishTranslator, type Translator } from '@/i18n';
import { canResumeUpload } from '@/reliability/status';
import type { RecordingStatus } from '@/shared/types';

export type HistoryMenuActionId = 'review' | 'upload' | 'export' | 'export_html' | 'identity' | 'judge_reason' | 'delete';

export type HistoryMenuAction = {
  id: HistoryMenuActionId;
  label: string;
  disabled: boolean;
  destructive?: boolean;
};

export function historyMenuActions(
  options: { status: RecordingStatus; busy: boolean; hasJudgeReason?: boolean },
  tr: Translator = englishTranslator
): HistoryMenuAction[] {
  const { status, busy, hasJudgeReason } = options;
  const resumable = canResumeUpload(status);
  return [
    {
      id: 'review',
      label: tr('actions.review'),
      disabled: status !== 'review_required' || busy
    },
    {
      id: 'upload',
      label: status === 'queued' ? tr('actions.upload') : tr('actions.resume'),
      disabled: !resumable || busy
    },
    ...(hasJudgeReason ? [{
      id: 'judge_reason' as const,
      label: tr('actions.judgeReason'),
      disabled: false
    }] : []),
    {
      id: 'export',
      label: tr('actions.exportJson'),
      disabled: busy
    },
    {
      id: 'export_html',
      label: tr('actions.exportHtml'),
      disabled: busy
    },
    {
      id: 'identity',
      label: tr('actions.viewIdentity'),
      disabled: false
    },
    {
      id: 'delete',
      label: tr('actions.deleteLocalCopy'),
      disabled: busy,
      destructive: true
    }
  ];
}

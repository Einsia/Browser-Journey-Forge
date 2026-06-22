import { englishTranslator, type Translator } from '@/i18n';
import type { RecordingStatus } from '@/shared/types';

export type ReviewPanelActionId =
  | 'confirm_upload'
  | 'save_details'
  | 'export_json'
  | 'export_html'
  | 'view_identity';

export type ReviewPanelAction = {
  id: ReviewPanelActionId;
  label: string;
  disabled: boolean;
};

export function reviewPanelActions(
  options: { status: RecordingStatus; busy: boolean; hasTask?: boolean },
  tr: Translator = englishTranslator
): ReviewPanelAction[] {
  return [
    {
      id: 'confirm_upload',
      label: tr(options.hasTask ? 'actions.confirmAndUpload' : 'actions.confirmAndUploadNoJudge'),
      disabled: options.status !== 'review_required' || options.busy
    },
    {
      id: 'save_details',
      label: tr('actions.saveDetails'),
      disabled: options.status !== 'review_required' || options.busy
    },
    {
      id: 'export_json',
      label: tr('actions.exportJson'),
      disabled: options.busy
    },
    {
      id: 'export_html',
      label: tr('actions.exportHtml'),
      disabled: options.busy
    },
    {
      id: 'view_identity',
      label: tr('actions.viewIdentity'),
      disabled: false
    }
  ];
}

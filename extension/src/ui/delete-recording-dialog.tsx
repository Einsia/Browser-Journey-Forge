import { useState } from 'react';
import { englishTranslator, type Translator } from '@/i18n';
import type { RecordingRow } from '@/shared/types';
import { deleteConfirmation } from '@/ui/delete-confirmation';
import { recordingLabel } from '@/ui/recording-label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button
} from '@/ui/primitives';

export function DeleteRecordingDialog(props: {
  recording: RecordingRow;
  tr?: Translator;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const tr = props.tr ?? englishTranslator;
  const confirmation = deleteConfirmation(
    { label: recordingLabel(props.recording, tr), traceId: props.recording.trace_id },
    tr
  );

  async function confirmDelete(): Promise<void> {
    setDeleting(true);
    try {
      await props.onConfirm();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !deleting && props.onCancel()}>
      <AlertDialogContent className="delete-modal">
        <div className="section-heading">
          <div>
            <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
            <code>{confirmation.traceId}</code>
          </div>
        </div>
        <AlertDialogDescription className="modal-copy">{confirmation.detail}</AlertDialogDescription>
        <div className="modal-actions">
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={deleting}>
              {confirmation.cancelLabel}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {confirmation.confirmLabel}
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}


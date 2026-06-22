import { englishTranslator, type Translator } from '@/i18n';
import type { BlobRow } from '@/shared/types';

export type MediaPreviewModel = {
  blobKey: string;
  kindLabel: string;
  previewable: boolean;
  stateLabel: string;
  stateTone: 'accepted' | 'rejected';
  alt: string;
};

export type PreviewUrl = {
  src: string;
  revoke(): void;
};

export type PreviewUrlApi = Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;

export function sortMediaRows(rows: BlobRow[]): BlobRow[] {
  return [...rows].sort((left, right) => left.created_at - right.created_at || left.blob_key.localeCompare(right.blob_key));
}

export function mediaPreviewModel(
  blob: BlobRow,
  tr: Translator = englishTranslator
): MediaPreviewModel {
  const excluded = Boolean(blob.excluded_from_upload);
  const kindLabel = blob.kind === 'screenshot' ? tr('media.legacyScreenshot') : tr('media.videoChunk');
  return {
    blobKey: blob.blob_key,
    kindLabel,
    previewable: isPreviewableMediaBlob(blob),
    stateLabel: excluded ? tr('media.excluded') : tr('media.included'),
    stateTone: excluded ? 'rejected' : 'accepted',
    alt: tr('media.previewAlt', { kind: kindLabel, blobKey: blob.blob_key })
  };
}

export function createPreviewUrl(data: Blob, urlApi: PreviewUrlApi = URL): PreviewUrl {
  const src = urlApi.createObjectURL(data);
  let revoked = false;
  return {
    src,
    revoke() {
      if (revoked) return;
      revoked = true;
      urlApi.revokeObjectURL(src);
    }
  };
}

function isPreviewableMediaBlob(blob: BlobRow): boolean {
  if (blob.kind === 'video') return blob.data.type === '' || blob.data.type.startsWith('video/');
  return blob.data.type === '' || blob.data.type.startsWith('image/');
}

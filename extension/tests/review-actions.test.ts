import { describe, expect, it } from 'vitest';
import { reviewPanelActions } from '@/ui/review-actions';

describe('review panel actions', () => {
  it('keeps upload and identity inspection as explicit review controls', () => {
    expect(reviewPanelActions({ status: 'review_required', busy: false }).map((action) => action.id)).toEqual([
      'confirm_upload',
      'save_details',
      'export_json',
      'export_html',
      'view_identity'
    ]);
  });

  it('only enables confirm upload while review is required and not busy', () => {
    expect(reviewPanelActions({ status: 'review_required', busy: false }).find((action) => action.id === 'confirm_upload')).toMatchObject({
      label: 'Confirm and upload',
      disabled: false
    });

    expect(reviewPanelActions({ status: 'accepted', busy: false }).find((action) => action.id === 'confirm_upload')).toMatchObject({
      disabled: true
    });

    expect(reviewPanelActions({ status: 'review_required', busy: true }).find((action) => action.id === 'confirm_upload')).toMatchObject({
      disabled: true
    });
  });

  it('only enables save details while review is required and not busy', () => {
    expect(reviewPanelActions({ status: 'review_required', busy: false }).find((action) => action.id === 'save_details')).toMatchObject({
      label: 'Save details',
      disabled: false
    });

    expect(reviewPanelActions({ status: 'queued', busy: false }).find((action) => action.id === 'save_details')).toMatchObject({
      disabled: true
    });

    expect(reviewPanelActions({ status: 'review_required', busy: true }).find((action) => action.id === 'save_details')).toMatchObject({
      disabled: true
    });
  });

  it('keeps generated identity available even while upload actions are busy', () => {
    expect(reviewPanelActions({ status: 'review_required', busy: true }).find((action) => action.id === 'view_identity')).toMatchObject({
      label: 'View identity',
      disabled: false
    });
  });

  it('disables export actions while review actions are busy', () => {
    expect(reviewPanelActions({ status: 'review_required', busy: false }).find((action) => action.id === 'export_json')).toMatchObject({
      label: 'Export JSON',
      disabled: false
    });
    expect(reviewPanelActions({ status: 'review_required', busy: true }).find((action) => action.id === 'export_json')).toMatchObject({
      disabled: true
    });

    expect(reviewPanelActions({ status: 'review_required', busy: false }).find((action) => action.id === 'export_html')).toMatchObject({
      label: 'Export HTML report',
      disabled: false
    });
    expect(reviewPanelActions({ status: 'review_required', busy: true }).find((action) => action.id === 'export_html')).toMatchObject({
      disabled: true
    });
  });
});

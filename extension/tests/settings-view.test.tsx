import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: vi.fn() },
    windows: { getCurrent: vi.fn() },
  },
}));

vi.mock('@/browser', () => ({
  getBrowserAdapter: () => ({
    capabilities: {
      browser: 'chrome',
      screenshots: false,
      video: true,
      webRequestBody: true,
      injectedResponseBody: true,
    },
  }),
}));

import { SettingsView } from '@/entrypoints/dashboard/App';
import { DEFAULT_CONFIG, db } from '@/storage/db';
import type { BrowserCapabilities } from '@/shared/types';

describe('SettingsView', () => {
  afterEach(async () => {
    await db.config.clear();
  });

  it('keeps unsaved edits when dashboard data refreshes', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn(async () => undefined);
    const onError = vi.fn();

    const { rerender } = render(
      <SettingsView
        config={DEFAULT_CONFIG}
        capabilities={capabilities}
        onSaved={onSaved}
        onError={onError}
      />
    );

    await user.type(screen.getByLabelText('Endpoint URL'), 'https://api.example.test');
    await user.selectOptions(screen.getByLabelText('Language'), 'zh-CN');

    rerender(
      <SettingsView
        config={{ ...DEFAULT_CONFIG }}
        capabilities={capabilities}
        onSaved={onSaved}
        onError={onError}
      />
    );

    expect(screen.getByLabelText('Endpoint URL')).toHaveValue(
      'https://api.example.test'
    );
    expect(screen.getByLabelText('Language')).toHaveValue('zh-CN');
  });

});

const capabilities: BrowserCapabilities = {
  browser: 'chrome',
  screenshots: false,
  video: true,
  webRequestBody: true,
  injectedResponseBody: true,
};

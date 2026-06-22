import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const entrypointFiles = [
  'src/entrypoints/popup/App.tsx',
  'src/entrypoints/dashboard/App.tsx',
];

const removedPatterns = [
  'className="notice',
  'className="panel',
  'className="tabs',
  'className="field',
  'className="popup-status',
  'className="popup-actions',
  'className="link-button',
  'className="identity-panel',
  'className="row-actions',
  'className="recording-table',
  'className="mode-option',
  'className="status-badge',
  'window.confirm',
  '<details',
];

describe('UI migration guard', () => {
  it('keeps extension surfaces on shared accessible primitives', () => {
    for (const file of entrypointFiles) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of removedPatterns) {
        expect(source, `${file} still contains ${pattern}`).not.toContain(
          pattern
        );
      }
    }
  });
});

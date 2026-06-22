import { describe, expect, it } from 'vitest';
import { createId } from '@/shared/id';
import { sha256Hex } from '@/shared/hash';

describe('shared utilities', () => {
  it('creates prefixed IDs', () => {
    expect(createId('tr_')).toMatch(/^tr_[a-z0-9]+_[a-f0-9]{24}$/);
  });

  it('hashes strings as sha256 hex', async () => {
    await expect(sha256Hex('hello')).resolves.toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });
});

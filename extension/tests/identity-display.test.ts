import { describe, expect, it } from 'vitest';
import { identityDisplayRows, recordingModeLabel } from '@/identity/display';
import type { IdentityBundle } from '@/shared/types';

describe('identity display', () => {
  const identity: IdentityBundle = {
    identity_bundle_id: 'idb_visible',
    email: 'operator@example.test',
    email_password: 'generated-password',
    webmail_url: 'https://mail.example.test/user/login',
    persona: {
      name: 'Alex Green',
      address: '123 Test Street'
    },
    payment: {
      enabled: true,
      test_card_label: 'Visa 4242',
      card_number: '4242424242424242',
      exp_month: '12',
      exp_year: '2030',
      cvc: '123'
    },
    expires_at: '2026-06-04T00:00:00.000Z'
  };

  it('renders generated credentials, persona, and payment fields', () => {
    expect(identityDisplayRows(identity)).toEqual([
      { group: 'Credentials', label: 'Email', value: 'operator@example.test', copyable: true },
      { group: 'Credentials', label: 'Password', value: 'generated-password', copyable: true, secret: true },
      { group: 'Credentials', label: 'Webmail', value: 'https://mail.example.test/user/login', copyable: true, href: 'https://mail.example.test/user/login' },
      { group: 'Credentials', label: 'Expires', value: '2026-06-04T00:00:00.000Z' },
      { group: 'Persona', label: 'name', value: 'Alex Green', copyable: true },
      { group: 'Persona', label: 'address', value: '123 Test Street', copyable: true },
      { group: 'Payment', label: 'enabled', value: 'true' },
      { group: 'Payment', label: 'test_card_label', value: 'Visa 4242', copyable: true },
      { group: 'Payment', label: 'card_number', value: '4242424242424242', copyable: true, secret: true },
      { group: 'Payment', label: 'exp_month', value: '12', copyable: true },
      { group: 'Payment', label: 'exp_year', value: '2030', copyable: true },
      { group: 'Payment', label: 'cvc', value: '123', copyable: true, secret: true }
    ]);
  });

  it('allows safe webmail href protocols', () => {
    const rows = identityDisplayRows({
      ...identity,
      webmail_url: 'https://purelymail.com/user/login'
    });

    expect(rows.find((row) => row.label === 'Webmail')).toMatchObject({
      value: 'https://purelymail.com/user/login',
      href: 'https://purelymail.com/user/login'
    });
  });

  it('keeps unsafe webmail values copyable but removes href', () => {
    const rows = identityDisplayRows({
      ...identity,
      webmail_url: 'javascript:alert(1)'
    });

    expect(rows.find((row) => row.label === 'Webmail')).toMatchObject({
      value: 'javascript:alert(1)',
      copyable: true
    });
    expect(rows.find((row) => row.label === 'Webmail')?.href).toBeUndefined();
  });

  it('removes href from http webmail values', () => {
    const rows = identityDisplayRows({
      ...identity,
      webmail_url: 'http://mail.example.test/user/login'
    });

    expect(rows.find((row) => row.label === 'Webmail')).toMatchObject({
      value: 'http://mail.example.test/user/login',
      copyable: true
    });
    expect(rows.find((row) => row.label === 'Webmail')?.href).toBeUndefined();
  });

  it('labels research and real-user modes distinctly', () => {
    expect(recordingModeLabel('research_free_form')).toEqual({
      label: 'Research collection',
      detail: 'Uses generated disposable identity and test payment data.'
    });
    expect(recordingModeLabel('real_user_free_form')).toEqual({
      label: 'Real user collection',
      detail: 'Does not generate credentials; the participant uses their own normal browser context.'
    });
  });
});

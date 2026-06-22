import { englishTranslator, type TranslationKey, type Translator } from '@/i18n';
import type { IdentityBundle, RecordingMode } from '@/shared/types';

export type IdentityDisplayGroup = string;

export type IdentityDisplayRow = {
  group: IdentityDisplayGroup;
  label: string;
  value: string;
  copyable?: boolean;
  secret?: boolean;
  href?: string;
};

const PAYMENT_SECRET_KEY_RE = /card.?number|cvc|cvv|security.?code/i;
const SAFE_WEBMAIL_PROTOCOLS = new Set(['https:', 'mailto:']);

function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    return SAFE_WEBMAIL_PROTOCOLS.has(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function identityDisplayRows(
  identity: IdentityBundle,
  tr: Translator = englishTranslator
): IdentityDisplayRow[] {
  const webmailHref = safeHref(identity.webmail_url);
  const rows: IdentityDisplayRow[] = [
    { group: tr('identity.groupCredentials'), label: tr('identity.email'), value: identity.email, copyable: true },
    { group: tr('identity.groupCredentials'), label: tr('identity.password'), value: identity.email_password, copyable: true, secret: true },
    { group: tr('identity.groupCredentials'), label: tr('identity.webmail'), value: identity.webmail_url, copyable: true, ...(webmailHref ? { href: webmailHref } : {}) },
    { group: tr('identity.groupCredentials'), label: tr('identity.expires'), value: identity.expires_at }
  ];

  for (const [key, value] of Object.entries(identity.persona)) {
    const i18nKey = `identity.${key}` as TranslationKey;
    const label = tr(i18nKey) !== i18nKey ? tr(i18nKey) : key;
    rows.push({ group: tr('identity.groupPersona'), label, value: String(value), copyable: true });
  }

  for (const [key, value] of Object.entries(identity.payment)) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    const i18nKey = `identity.${key}` as TranslationKey;
    const label = tr(i18nKey) !== i18nKey ? tr(i18nKey) : key;
    rows.push({
      group: tr('identity.groupPayment'),
      label,
      value: text,
      ...(typeof value === 'string' || typeof value === 'number' ? { copyable: true } : {}),
      ...(PAYMENT_SECRET_KEY_RE.test(key) ? { secret: true } : {})
    });
  }

  return rows;
}

export function recordingModeLabel(
  mode: RecordingMode,
  tr: Translator = englishTranslator
): { label: string; detail: string } {
  if (mode === 'real_user_free_form') {
    return {
      label: tr('mode.realUserLabel'),
      detail: tr('mode.realUserDetail')
    };
  }
  return {
    label: tr('mode.researchLabel'),
    detail: tr('mode.researchDetail')
  };
}

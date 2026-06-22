import type { CaptchaProvider, DomSnapshotEvent, FrameMetadata } from '@/shared/types';

const PROVIDERS: Array<{ provider: CaptchaProvider; patterns: RegExp[] }> = [
  { provider: 'google_recaptcha', patterns: [/recaptcha/i, /google\.com$/i, /gstatic\.com$/i] },
  { provider: 'hcaptcha', patterns: [/hcaptcha/i] },
  { provider: 'cloudflare_turnstile', patterns: [/turnstile/i, /challenges\.cloudflare\.com$/i] },
  { provider: 'arkose', patterns: [/arkose/i, /funcaptcha/i] },
  { provider: 'geetest', patterns: [/geetest/i] }
];

const GENERIC_CAPTCHA_RE = /captcha|challenge|verification/i;

export function frameMetadataFor(element: HTMLIFrameElement): FrameMetadata {
  const safeSrc = safeFrameSrc(element.getAttribute('src'));
  const title = clean(element.getAttribute('title'));
  const name = clean(element.getAttribute('name'));
  const sandbox = clean(element.getAttribute('sandbox'));
  const haystack = [safeSrc.srcHost, safeSrc.srcPath, title, name, element.id, element.className].filter(Boolean).join(' ');
  const provider = detectCaptchaProvider(haystack);
  const isCaptcha = Boolean(provider) || GENERIC_CAPTCHA_RE.test(haystack);

  return {
    isCaptcha,
    ...(provider ? { provider } : isCaptcha ? { provider: 'generic_captcha' as const } : {}),
    ...safeSrc,
    ...(title ? { title } : {}),
    ...(name ? { name } : {}),
    ...(sandbox ? { sandbox } : {})
  };
}

export function captchaProvidersFromSnapshot(snapshot: DomSnapshotEvent): CaptchaProvider[] {
  const providers = new Set<CaptchaProvider>();
  for (const node of snapshot.nodes) {
    const provider = node.frame?.isCaptcha ? node.frame.provider ?? 'generic_captcha' : null;
    if (provider) providers.add(provider);
  }
  return [...providers].sort();
}

function detectCaptchaProvider(value: string): CaptchaProvider | null {
  for (const candidate of PROVIDERS) {
    if (candidate.patterns.some((pattern) => pattern.test(value))) return candidate.provider;
  }
  return null;
}

function safeFrameSrc(src: string | null): Pick<FrameMetadata, 'srcHost' | 'srcPath'> {
  if (!src) return {};
  try {
    const url = new URL(src, location.href);
    return {
      srcHost: url.hostname,
      srcPath: url.pathname || '/'
    };
  } catch {
    return {};
  }
}

function clean(value: string | null): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned || undefined;
}

import { describe, expect, it } from 'vitest';
import { redactEvent, redactText } from '@/redaction/redactor';
import type {
  ActionEvent,
  DomSnapshotEvent,
  FormSummaryEvent,
  IdentityBundle,
  NetworkRequestEvent,
  NetworkResponseEvent
} from '@/shared/types';

const identity: IdentityBundle = {
  identity_bundle_id: 'idb_test',
  email: 'forge-user@example.test',
  email_password: 'generated-password-123',
  webmail_url: 'https://mail.example.test',
  persona: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+1 415 555 0198'
  },
  payment: { enabled: true, test_card_label: 'Visa test' },
  expires_at: '2026-06-04T00:00:00.000Z'
};

describe('redactText', () => {
  it('removes email values and preserves redaction metadata', () => {
    const redacted = redactText('send receipt to shopper@example.com');

    expect(redacted.value).toBeNull();
    expect(redacted.redaction).toMatchObject({
      strategy: 'raw_removed',
      classes: ['classified_email'],
      originalLength: 35
    });
    expect(redacted.redaction?.digest).toBe(
      'sha256:1efe2aa9f0588bef2a59f13550df51d7e8ae8837c8f21524af2f13f3894d378e'
    );
  });

  it('classifies password fields by field name', () => {
    const redacted = redactText('correct horse battery staple', { fieldName: 'new_password' });

    expect(redacted.value).toBeNull();
    expect(redacted.redaction?.classes).toContain('classified_password');
  });

  it('classifies password values by input type when field names are generic', () => {
    const redacted = redactText('correct horse battery staple', { fieldName: 'current', inputType: 'password' });

    expect(redacted.value).toBeNull();
    expect(redacted.redaction?.classes).toContain('classified_password');
  });

  it('removes card-like values', () => {
    const redacted = redactText('4111 1111 1111 1111');

    expect(redacted.value).toBeNull();
    expect(redacted.redaction?.classes).toContain('classified_payment');
  });

  it('removes OTP-like values in verification contexts', () => {
    const redacted = redactText('123456', { fieldName: 'verification_code' });

    expect(redacted.value).toBeNull();
    expect(redacted.redaction?.classes).toContain('classified_otp');
  });

  it('classifies expiry and government identifier fields conservatively', () => {
    expect(redactText('12/30', { fieldName: 'card_expiration' }).redaction?.classes).toContain('classified_payment');
    expect(redactText('123-45-6789', { fieldName: 'ssn' }).redaction?.classes).toContain('classified_token');
  });

  it('removes exact generated identity values', () => {
    expect(redactText('forge-user@example.test', { identity }).redaction?.classes).toContain('classified_email');
    expect(redactText('generated-password-123', { identity }).redaction?.classes).toContain('classified_password');
    expect(redactText('Ada', { identity }).redaction?.classes).toContain('classified_address');
  });

  it('removes large bodies and records the original length', () => {
    const redacted = redactText('x'.repeat(4097));

    expect(redacted.value).toBeNull();
    expect(redacted.redaction).toMatchObject({
      strategy: 'body_excluded',
      classes: ['large_body'],
      originalLength: 4097
    });
  });
});

describe('redactEvent', () => {
  it('redacts action values without mutating the original event', () => {
    const event: ActionEvent = {
      event_id: 'ev_action',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'action',
      action_type: 'input',
      target: {
        tag: 'input',
        name: 'email',
        inputType: 'text',
        selector: 'input[name=email]',
        xpath: '/html/body/input'
      },
      value: { value: 'shopper@example.com' }
    };

    const redacted = redactEvent(event);

    expect(redacted).not.toBe(event);
    expect(redacted.kind).toBe('action');
    if (redacted.kind !== 'action') throw new Error('expected action event');
    expect(redacted.value?.value).toBeNull();
    expect(redacted.value?.redaction?.classes).toContain('classified_email');
    expect(event.value?.value).toBe('shopper@example.com');
  });

  it('redacts password action values using input type metadata when the name is generic', () => {
    const event: ActionEvent = {
      event_id: 'ev_password_type',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'action',
      action_type: 'input',
      target: {
        tag: 'input',
        name: 'current',
        inputType: 'password',
        selector: 'input[name=current]',
        xpath: '/html/body/input'
      },
      value: { value: 'correct horse battery staple' }
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('action');
    if (redacted.kind !== 'action') throw new Error('expected action event');
    expect(redacted.value?.value).toBeNull();
    expect(redacted.value?.redaction?.classes).toContain('classified_password');
  });

  it('redacts sensitive action target text without leaking raw strings', () => {
    const event: ActionEvent = {
      event_id: 'ev_target_text',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'action',
      action_type: 'click',
      target: {
        tag: 'button',
        text: 'Continue as forge-user@example.test',
        selector: 'button',
        xpath: '/html/body/button'
      }
    };

    const redacted = redactEvent(event, identity);

    expect(redacted.kind).toBe('action');
    if (redacted.kind !== 'action') throw new Error('expected action event');
    expect(redacted.target?.text).toBe('[redacted]');
    expect(event.target?.text).toContain('forge-user@example.test');
  });

  it('keeps interaction metadata while removing selected text and filenames', () => {
    const fileEvent: ActionEvent = {
      event_id: 'ev_file',
      trace_id: 'tr_schema',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test/upload',
      kind: 'action',
      action_type: 'file_select',
      target: {
        tag: 'input',
        inputType: 'file',
        selector: 'input[type=file]',
        xpath: '/html/body/input'
      },
      files: {
        count: 2,
        total_bytes: 1234,
        accepted_types: ['application/pdf'],
        selected_types: ['application/pdf'],
        filenames: { value: ['resume-private.pdf'] }
      }
    };
    const selectionEvent: ActionEvent = {
      event_id: 'ev_selection',
      trace_id: 'tr_schema',
      tab_id: 1,
      timestamp: 2,
      url: 'https://example.test/doc',
      kind: 'action',
      action_type: 'selection',
      selection: {
        text: { value: 'private selected text' },
        length: 21
      }
    };

    const redactedFile = redactEvent(fileEvent);
    const redactedSelection = redactEvent(selectionEvent);

    expect(JSON.stringify(redactedFile)).not.toContain('resume-private.pdf');
    expect(JSON.stringify(redactedSelection)).not.toContain('private selected text');
    expect(redactedFile).toMatchObject({
      kind: 'action',
      action_type: 'file_select',
      files: { count: 2, total_bytes: 1234, selected_types: ['application/pdf'] }
    });
    expect(redactedSelection).toMatchObject({
      kind: 'action',
      action_type: 'selection',
      selection: { length: 21 }
    });
    expect(fileEvent.files?.filenames?.value).toEqual(['resume-private.pdf']);
    expect(selectionEvent.selection?.text?.value).toBe('private selected text');
  });

  it('redacts DOM node text and values', () => {
    const event: DomSnapshotEvent = {
      event_id: 'ev_dom',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'dom_snapshot',
      hash: 'hash',
      nodes: [
        {
          ref: 1,
          tag: 'input',
          name: 'password',
          text: { value: 'Password' },
          value: { value: 'generated-password-123' },
          inputType: 'password',
          selector: 'input[name=password]'
        }
      ]
    };

    const redacted = redactEvent(event, identity);

    expect(redacted.kind).toBe('dom_snapshot');
    if (redacted.kind !== 'dom_snapshot') throw new Error('expected dom snapshot event');
    expect(redacted.nodes[0]?.value?.value).toBeNull();
    expect(redacted.nodes[0]?.value?.redaction?.classes).toContain('classified_password');
    expect(redacted.nodes[0]?.text?.value).toBeNull();
    expect(redacted.nodes[0]?.text?.redaction?.classes).toContain('classified_password');
  });

  it('redacts DOM password text using input type context even when the name is generic', () => {
    const event: DomSnapshotEvent = {
      event_id: 'ev_dom_text',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'dom_snapshot',
      hash: 'hash',
      nodes: [
        {
          ref: 1,
          tag: 'input',
          name: 'current',
          inputType: 'password',
          text: { value: 'correct horse battery staple' },
          value: { value: 'correct horse battery staple' },
          selector: 'input[name=current]'
        }
      ]
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('dom_snapshot');
    if (redacted.kind !== 'dom_snapshot') throw new Error('expected dom snapshot event');
    expect(redacted.nodes[0]?.text?.value).toBeNull();
    expect(redacted.nodes[0]?.value?.value).toBeNull();
    expect(redacted.nodes[0]?.text?.redaction?.classes).toContain('classified_password');
  });

  it('redacts DOM file input fake paths using input type metadata', () => {
    const event: DomSnapshotEvent = {
      event_id: 'ev_dom_file',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'dom_snapshot',
      hash: 'hash',
      nodes: [
        {
          ref: 1,
          tag: 'input',
          inputType: 'file',
          value: { value: 'C:\\fakepath\\smoke-upload.txt' },
          selector: 'input[type=file]'
        }
      ]
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('dom_snapshot');
    if (redacted.kind !== 'dom_snapshot') throw new Error('expected dom snapshot event');
    expect(JSON.stringify(redacted)).not.toContain('smoke-upload.txt');
    expect(redacted.nodes[0]?.value?.value).toBeNull();
    expect(redacted.nodes[0]?.value?.redaction?.classes).toContain('classified_token');
  });

  it('redacts DOM iframe metadata before upload', () => {
    const event: DomSnapshotEvent = {
      event_id: 'ev_frame',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'dom_snapshot',
      hash: 'hash',
      nodes: [
        {
          ref: 1,
          tag: 'iframe',
          name: 'forge-user@example.test challenge',
          selector: 'iframe',
          frame: {
            isCaptcha: true,
            provider: 'generic_captcha',
            srcHost: 'captcha.example.test',
            srcPath: '/challenge/forge-user@example.test/token-secret',
            title: 'Verify forge-user@example.test',
            name: 'forge-user@example.test challenge'
          }
        }
      ]
    };

    const redacted = redactEvent(event, identity);

    expect(redacted.kind).toBe('dom_snapshot');
    if (redacted.kind !== 'dom_snapshot') throw new Error('expected dom snapshot event');
    expect(redacted.nodes[0]?.name).toBe('[redacted]');
    expect(redacted.nodes[0]?.frame).toMatchObject({
      isCaptcha: true,
      provider: 'generic_captcha',
      srcHost: 'captcha.example.test',
      srcPath: '[redacted]',
      title: '[redacted]',
      name: '[redacted]'
    });
  });

  it('redacts auth headers and network request bodies', () => {
    const event: NetworkRequestEvent = {
      event_id: 'ev_req',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://api.example.test',
      kind: 'network_request',
      request_id: 'req_1',
      method: 'POST',
      full_url: 'https://api.example.test/checkout',
      fetch_kind: 'fetch',
      req_headers: {
        authorization: { value: 'Bearer secret-token' },
        'content-type': { value: 'application/json' }
      },
      req_body: { value: JSON.stringify({ card: '4111111111111111' }) }
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('network_request');
    if (redacted.kind !== 'network_request') throw new Error('expected network request event');
    expect(redacted.req_headers.authorization?.value).toBeNull();
    expect(redacted.req_headers.authorization?.redaction?.classes).toContain('classified_token');
    expect(redacted.req_headers['content-type']?.value).toBe('application/json');
    expect(redacted.req_body?.value).toBeNull();
    expect(redacted.req_body?.redaction?.classes).toContain('classified_payment');
  });

  it('keeps the raw request body in V2 mode while still redacting headers', () => {
    const event: NetworkRequestEvent = {
      event_id: 'ev_req_v2',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://api.example.test',
      kind: 'network_request',
      request_id: 'req_v2',
      method: 'POST',
      full_url: 'https://api.example.test/checkout',
      fetch_kind: 'fetch',
      req_headers: {
        authorization: { value: 'Bearer secret-token' },
        'content-type': { value: 'application/json' }
      },
      req_body: { value: JSON.stringify({ card: '4111111111111111' }) }
    };

    const redacted = redactEvent(event, undefined, { keepRequestBodies: true });

    expect(redacted.kind).toBe('network_request');
    if (redacted.kind !== 'network_request') throw new Error('expected network request event');
    // V2: body preserved verbatim for the judge…
    expect(redacted.req_body?.value).toBe(JSON.stringify({ card: '4111111111111111' }));
    expect(redacted.req_body?.redaction).toBeUndefined();
    // …but auth headers are still redacted.
    expect(redacted.req_headers.authorization?.value).toBeNull();
  });

  it('redacts small JSON bodies with sensitive keys', () => {
    const event: NetworkRequestEvent = {
      event_id: 'ev_json_body',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://api.example.test',
      kind: 'network_request',
      request_id: 'req_json',
      method: 'POST',
      full_url: 'https://api.example.test/login',
      fetch_kind: 'fetch',
      req_headers: {},
      req_body: { value: '{"password":"correct horse battery staple","token":"secret-token"}' }
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('network_request');
    if (redacted.kind !== 'network_request') throw new Error('expected network request event');
    expect(redacted.req_body?.value).toBeNull();
    expect(redacted.req_body?.redaction?.classes).toEqual(
      expect.arrayContaining(['classified_password', 'classified_token'])
    );
  });

  it('redacts URLSearchParams-like bodies with sensitive auth keys', () => {
    const event: NetworkRequestEvent = {
      event_id: 'ev_form_body',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://api.example.test',
      kind: 'network_request',
      request_id: 'req_form',
      method: 'POST',
      full_url: 'https://api.example.test/session',
      fetch_kind: 'fetch',
      req_headers: {},
      req_body: { value: 'auth_token=secret-token&email=person%40example.test' }
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('network_request');
    if (redacted.kind !== 'network_request') throw new Error('expected network request event');
    expect(redacted.req_body?.value).toBeNull();
    expect(redacted.req_body?.redaction?.classes).toEqual(expect.arrayContaining(['classified_token', 'classified_email']));
  });

  it('redacts internal URLs from URL fields and hrefs', () => {
    const event: NetworkRequestEvent = {
      event_id: 'ev_internal_url',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'chrome-extension://extension-id/page.html',
      kind: 'network_request',
      request_id: 'req_internal',
      method: 'GET',
      full_url: 'file:///Users/test/download.txt',
      initiator: 'moz-extension://extension-id/background.js',
      fetch_kind: 'fetch',
      req_headers: {},
      req_body: { value: 'file:///Users/test/download.txt' }
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('network_request');
    if (redacted.kind !== 'network_request') throw new Error('expected network request event');
    expect(redacted.url).toBe('[internal-url-redacted]');
    expect(redacted.full_url).toBe('[internal-url-redacted]');
    expect(redacted.initiator).toBe('[internal-url-redacted]');
    expect(redacted.req_body?.value).toBeNull();
    expect(redacted.req_body?.redaction?.classes).toContain('classified_token');
  });

  it('redacts sensitive HTTPS query values while preserving safe params', () => {
    const event: NetworkRequestEvent = {
      event_id: 'ev_query_url',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test/reset?email=shopper@example.com&auth_token=secret-token&page=checkout',
      kind: 'network_request',
      request_id: 'req_query',
      method: 'GET',
      full_url:
        'https://example.test/reset?email=shopper@example.com&auth_token=secret-token&page=checkout&next=%2Fdone',
      initiator: 'https://app.example.test/start?session=secret-session&view=signup',
      fetch_kind: 'fetch',
      req_headers: {}
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('network_request');
    if (redacted.kind !== 'network_request') throw new Error('expected network request event');
    expect(redacted.url).toBe('https://example.test/reset?email=%5Bredacted%5D&auth_token=%5Bredacted%5D&page=checkout');
    expect(redacted.full_url).toBe(
      'https://example.test/reset?email=%5Bredacted%5D&auth_token=%5Bredacted%5D&page=checkout&next=%2Fdone'
    );
    expect(redacted.initiator).toBe('https://app.example.test/start?session=%5Bredacted%5D&view=signup');
    expect(redacted.url).not.toContain('shopper@example.com');
    expect(redacted.full_url).not.toContain('secret-token');
    expect(redacted.initiator).not.toContain('secret-session');
  });

  it('redacts exact identity query values from network URL fields even when keys look safe', () => {
    const event: NetworkRequestEvent = {
      event_id: 'ev_identity_query_url',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test/cb?next=generated-password-123&step=done',
      kind: 'network_request',
      request_id: 'req_identity_query',
      method: 'GET',
      full_url: 'https://example.test/cb?name=Ada&mail=forge-user%40example.test&step=done',
      initiator: 'https://app.example.test/start?who=Lovelace&view=signup',
      fetch_kind: 'fetch',
      req_headers: {}
    };

    const redacted = redactEvent(event, identity);

    expect(redacted.kind).toBe('network_request');
    if (redacted.kind !== 'network_request') throw new Error('expected network request event');
    expect(redacted.url).toBe('https://example.test/cb?next=%5Bredacted%5D&step=done');
    expect(redacted.full_url).toBe('https://example.test/cb?name=%5Bredacted%5D&mail=%5Bredacted%5D&step=done');
    expect(redacted.initiator).toBe('https://app.example.test/start?who=%5Bredacted%5D&view=signup');
    expect(redacted.url).not.toContain('generated-password-123');
    expect(redacted.full_url).not.toContain('Ada');
    expect(redacted.initiator).not.toContain('Lovelace');
  });

  it('redacts sensitive query values from navigation fields', () => {
    const redacted = redactEvent({
      event_id: 'ev_nav_query',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test/verify?code=123456&step=2',
      kind: 'navigation',
      nav_type: 'load',
      from_url: 'https://example.test/start?phone=%2B14155550198',
      to_url: 'https://example.test/verify?verification=123456&step=2'
    });

    expect(redacted.kind).toBe('navigation');
    if (redacted.kind !== 'navigation') throw new Error('expected navigation event');
    expect(redacted.url).toBe('https://example.test/verify?code=%5Bredacted%5D&step=2');
    expect(redacted.from_url).toBe('https://example.test/start?phone=%5Bredacted%5D');
    expect(redacted.to_url).toBe('https://example.test/verify?verification=%5Bredacted%5D&step=2');
  });

  it('redacts exact identity query values from navigation fields and DOM hrefs', () => {
    const nav = redactEvent(
      {
        event_id: 'ev_identity_nav_query',
        trace_id: 'tr_test',
        tab_id: 1,
        timestamp: 1,
        url: 'https://example.test/cb?next=generated-password-123&step=2',
        kind: 'navigation',
        nav_type: 'load',
        from_url: 'https://example.test/start?person=Ada&view=signup',
        to_url: 'https://example.test/cb?mail=forge-user%40example.test&step=2'
      },
      identity
    );
    const dom = redactEvent(
      {
        event_id: 'ev_identity_href_query',
        trace_id: 'tr_test',
        tab_id: 1,
        timestamp: 1,
        url: 'https://example.test',
        kind: 'dom_snapshot',
        hash: 'hash',
        nodes: [
          {
            ref: 1,
            tag: 'a',
            text: { value: 'continue' },
            href: 'https://example.test/cb?name=Ada&next=generated-password-123&step=done',
            selector: 'a'
          }
        ]
      },
      identity
    );

    expect(nav.kind).toBe('navigation');
    if (nav.kind !== 'navigation') throw new Error('expected navigation event');
    expect(nav.url).toBe('https://example.test/cb?next=%5Bredacted%5D&step=2');
    expect(nav.from_url).toBe('https://example.test/start?person=%5Bredacted%5D&view=signup');
    expect(nav.to_url).toBe('https://example.test/cb?mail=%5Bredacted%5D&step=2');
    expect(dom.kind).toBe('dom_snapshot');
    if (dom.kind !== 'dom_snapshot') throw new Error('expected dom snapshot event');
    expect(dom.nodes[0]?.href).toBe(
      'https://example.test/cb?name=%5Bredacted%5D&next=%5Bredacted%5D&step=done'
    );
  });

  it('redacts internal DOM href values', () => {
    const event: DomSnapshotEvent = {
      event_id: 'ev_dom_href',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'dom_snapshot',
      hash: 'hash',
      nodes: [
        {
          ref: 1,
          tag: 'a',
          text: { value: 'download' },
          href: 'blob:https://example.test/blob-id',
          selector: 'a'
        }
      ]
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('dom_snapshot');
    if (redacted.kind !== 'dom_snapshot') throw new Error('expected dom snapshot event');
    expect(redacted.nodes[0]?.href).toBe('[internal-url-redacted]');
  });

  it('redacts network response bodies', () => {
    const event: NetworkResponseEvent = {
      event_id: 'ev_res',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://api.example.test',
      kind: 'network_response',
      request_id: 'req_1',
      status: 200,
      res_body: { value: 'Your verification code is 123456' }
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('network_response');
    if (redacted.kind !== 'network_response') throw new Error('expected network response event');
    expect(redacted.res_body?.value).toBeNull();
    expect(redacted.res_body?.redaction?.classes).toContain('classified_otp');
  });

  it('redacts sensitive query values from websocket stream URLs', () => {
    const redacted = redactEvent({
      event_id: 'ev_stream',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test/page?email=forge-user@example.test',
      kind: 'network_stream',
      stream_type: 'websocket',
      phase: 'message',
      stream_id: 'ws_1',
      full_url: 'wss://example.test/socket?token=secret-token&step=1',
      direction: 'incoming',
      byte_count: 10
    });

    expect(redacted.kind).toBe('network_stream');
    if (redacted.kind !== 'network_stream') throw new Error('expected network stream event');
    expect(redacted.url).toBe('https://example.test/page?email=%5Bredacted%5D');
    expect(redacted.full_url).toBe('wss://example.test/socket?token=%5Bredacted%5D&step=1');
  });

  it('adds field redaction classes and digests to form summaries', () => {
    const event: FormSummaryEvent = {
      event_id: 'ev_form',
      trace_id: 'tr_test',
      tab_id: 1,
      timestamp: 1,
      url: 'https://example.test',
      kind: 'form_summary',
      form_selector: 'form',
      phase: 'edited',
      fields: [
        { name: 'password', type: 'password', redactionClasses: [] },
        { name: 'email', type: 'email', redactionClasses: [] }
      ]
    };

    const redacted = redactEvent(event);

    expect(redacted.kind).toBe('form_summary');
    if (redacted.kind !== 'form_summary') throw new Error('expected form summary event');
    expect(redacted.fields[0]?.redactionClasses).toContain('classified_password');
    expect(redacted.fields[0]?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(redacted.fields[1]?.redactionClasses).toContain('classified_email');
  });
});

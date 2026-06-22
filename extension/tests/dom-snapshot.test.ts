import { describe, expect, it } from 'vitest';
import { captureDomSnapshot } from '@/capture/dom-snapshot';

describe('captureDomSnapshot', () => {
  it('captures input type metadata for password fields', async () => {
    document.body.innerHTML = '<input type="password" name="current" value="secret">';
    const input = document.querySelector('input')!;
    input.getBoundingClientRect = () =>
      ({
        x: 1,
        y: 2,
        width: 3,
        height: 4
      }) as DOMRect;

    const snapshot = await captureDomSnapshot({
      traceId: 'tr_dom',
      now: () => 1,
      url: () => 'https://example.test'
    });

    expect(snapshot.nodes[0]).toMatchObject({
      tag: 'input',
      name: 'current',
      inputType: 'password'
    });
  });

  it('captures safe CAPTCHA iframe metadata without query strings', async () => {
    document.body.innerHTML = `
      <iframe
        title="reCAPTCHA"
        name="a-test"
        src="https://www.google.com/recaptcha/api2/anchor?k=site-key&co=https%3A%2F%2Fshop.example"
      ></iframe>
    `;
    const frame = document.querySelector('iframe')!;
    frame.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 20,
        width: 304,
        height: 78
      }) as DOMRect;

    const snapshot = await captureDomSnapshot({
      traceId: 'tr_dom',
      now: () => 1,
      url: () => 'https://shop.example/checkout'
    });

    expect(snapshot.nodes[0]).toMatchObject({
      tag: 'iframe',
      name: 'reCAPTCHA',
      frame: {
        isCaptcha: true,
        provider: 'google_recaptcha',
        srcHost: 'www.google.com',
        srcPath: '/recaptcha/api2/anchor'
      },
      rect: { x: 10, y: 20, w: 304, h: 78 }
    });
    expect(JSON.stringify(snapshot.nodes[0])).not.toContain('site-key');
    expect(JSON.stringify(snapshot.nodes[0])).not.toContain('shop.example');
  });

  it('does not classify ordinary provider iframes as CAPTCHA without challenge signals', async () => {
    document.body.innerHTML = '<iframe title="Map" src="https://www.google.com/maps/embed?pb=secret"></iframe>';
    document.querySelector('iframe')!.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 300,
        height: 200
      }) as DOMRect;

    const snapshot = await captureDomSnapshot({
      traceId: 'tr_dom',
      now: () => 1,
      url: () => 'https://shop.example/contact'
    });

    expect(snapshot.nodes[0]?.frame).toMatchObject({
      isCaptcha: false,
      srcHost: 'www.google.com',
      srcPath: '/maps/embed'
    });
  });
});

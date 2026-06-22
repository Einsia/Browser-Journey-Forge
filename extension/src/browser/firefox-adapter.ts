import { BASE_CAPABILITIES, makeBrowserAdapter } from './make-adapter';

export const firefoxAdapter = makeBrowserAdapter({ ...BASE_CAPABILITIES, browser: 'firefox' });

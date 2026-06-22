import { BASE_CAPABILITIES, makeBrowserAdapter } from './make-adapter';

export const chromeAdapter = makeBrowserAdapter({ ...BASE_CAPABILITIES, browser: 'chrome' });

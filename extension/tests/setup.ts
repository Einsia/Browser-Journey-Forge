import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

if (!window.PointerEvent) {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

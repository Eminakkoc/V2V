import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't implement these; the vendored Radix Select and Slider call
// them unconditionally (pointer capture on drag/open, scrollIntoView on the
// selected item), so component tests using them would throw without a stub.
// Only jsdom-environment test files touch `Element`, so guard for the
// default "node" environment where it doesn't exist.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    const captured = new WeakMap<Element, Set<number>>();
    Element.prototype.setPointerCapture = function (pointerId: number) {
      const ids = captured.get(this) ?? new Set<number>();
      ids.add(pointerId);
      captured.set(this, ids);
    };
    Element.prototype.releasePointerCapture = function (pointerId: number) {
      captured.get(this)?.delete(pointerId);
    };
    Element.prototype.hasPointerCapture = function (pointerId: number) {
      return captured.get(this)?.has(pointerId) ?? false;
    };
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
}

// The Slider thumb measures itself with ResizeObserver, which jsdom also
// doesn't implement. Never firing is fine: it only affects an in-bounds
// pixel offset, not the value the thumb reports.
if (typeof ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

afterEach(() => {
  cleanup();
});

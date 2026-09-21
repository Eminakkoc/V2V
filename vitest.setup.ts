import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements neither, and the vendored Radix Select and Slider call them unconditionally; guarded because only jsdom-environment test files have `Element`.
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

// jsdom has no ResizeObserver either; never firing is fine, since it only affects an in-bounds pixel offset.
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

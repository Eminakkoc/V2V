// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOnline, isOnlineOnServer, subscribeOnlineStatus } from "./online-status";

afterEach(() => {
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("online-status", () => {
  it("reads the current navigator.onLine value", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    expect(isOnline()).toBe(false);

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    expect(isOnline()).toBe(true);
  });

  // The server has no `navigator`; assuming online keeps a server-rendered
  // page from ever showing the offline banner before hydration.
  it("assumes online for the server snapshot", () => {
    expect(isOnlineOnServer()).toBe(true);
  });

  it("notifies the subscriber on both online and offline events, and stops once unsubscribed", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeOnlineStatus(onChange);

    window.dispatchEvent(new Event("offline"));
    expect(onChange).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new Event("offline"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

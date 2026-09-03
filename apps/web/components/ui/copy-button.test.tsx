import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CopyButton,
  copyToClipboard,
  createCopyResetTimer,
} from "./copy-button";

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalNavigator)
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function installClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText } },
  });
}

describe("CopyButton", () => {
  it("writes the exact canonical URL only after the Clipboard API resolves", async () => {
    let resolveWrite: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    installClipboard(writeText);

    let settled = false;
    const copy = copyToClipboard(
      "https://media.example/series/chapter/image.jpg",
    ).then((result) => {
      settled = true;
      return result;
    });
    expect(writeText).toHaveBeenCalledWith(
      "https://media.example/series/chapter/image.jpg",
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveWrite?.();
    await expect(copy).resolves.toBe(true);
  });

  it("returns a controlled failure for rejected or unavailable Clipboard APIs", async () => {
    installClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    await expect(
      copyToClipboard("https://media.example/image.jpg"),
    ).resolves.toBe(false);

    Reflect.deleteProperty(globalThis, "navigator");
    await expect(
      copyToClipboard("https://media.example/image.jpg"),
    ).resolves.toBe(false);
  });

  it("allows a successful retry after a failed write", async () => {
    const writeText = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(undefined);
    installClipboard(writeText);

    await expect(
      copyToClipboard("https://media.example/image.jpg"),
    ).resolves.toBe(false);
    await expect(
      copyToClipboard("https://media.example/image.jpg"),
    ).resolves.toBe(true);
  });

  it("cleans the prior reset timer and disposes the final timer", () => {
    const setTimeout = vi.fn(() => 42);
    const clearTimeout = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { setTimeout, clearTimeout },
    });
    const resetTimer = createCopyResetTimer();

    resetTimer.schedule(() => undefined, 1500);
    resetTimer.schedule(() => undefined, 1500);
    resetTimer.dispose();

    expect(clearTimeout).toHaveBeenCalledTimes(2);
    expect(clearTimeout).toHaveBeenLastCalledWith(42);
  });

  it("does not copy empty values", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);

    await expect(copyToClipboard("")).resolves.toBe(false);
    await expect(copyToClipboard(undefined)).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("renders an accessible, disabled control when no URL is available", () => {
    const markup = renderToStaticMarkup(<CopyButton value={null} />);
    expect(markup).toContain("Copiar URL");
    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-live="polite"');
  });

  it("keeps multiple copy controls independent", () => {
    const markup = renderToStaticMarkup(
      <>
        <CopyButton value="https://media.example/one.jpg" />
        <CopyButton value="https://media.example/two.jpg" />
      </>,
    );
    expect(markup.match(/Copiar URL/g) ?? []).toHaveLength(2);
  });
});

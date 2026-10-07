// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImageCropModal } from "./ImageCropModal";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("zooms once per wheel event, cancels page scrolling and removes the listener on close", () => {
  vi.stubGlobal("URL", { createObjectURL: () => "blob:portrait", revokeObjectURL: vi.fn() });
  const { unmount } = render(<StrictMode><ImageCropModal
    file={new File(["portrait"], "portrait.png", { type: "image/png" })}
    shape="square" onCancel={vi.fn()} onSkip={vi.fn()} onConfirm={vi.fn()}
  /></StrictMode>);
  const viewport = document.querySelector(".crop-viewport")!;
  const wheel = new WheelEvent("wheel", { deltaY: -500, bubbles: true, cancelable: true });
  fireEvent(viewport, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("1.5");
  fireEvent.wheel(viewport, { deltaY: -10000 });
  expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("4");
  fireEvent.wheel(viewport, { deltaY: 10000 });
  expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("1");
  unmount();
  expect(viewport.dispatchEvent(new WheelEvent("wheel", { cancelable: true }))).toBe(true);
});

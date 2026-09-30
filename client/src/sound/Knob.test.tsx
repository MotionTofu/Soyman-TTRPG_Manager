// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Knob } from "./Knob";

afterEach(() => vi.restoreAllMocks());

describe("Knob", () => {
  it("follows the pointer before the remote volume update arrives", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    const slider = screen.getByRole("slider");
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 160, height: 160,
      right: 160, bottom: 160, toJSON: () => {},
    });

    fireEvent.pointerDown(slider, { clientX: 80, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 80 });

    expect(slider.getAttribute("aria-valuenow")).toBe("17");
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(1 / 6));
    fireEvent.pointerUp(window);
  });
});

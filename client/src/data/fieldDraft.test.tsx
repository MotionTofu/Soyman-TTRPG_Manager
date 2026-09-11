// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFieldDraft } from "./fieldDraft";

function setup(initial: string) {
  return renderHook(({ value }) => useFieldDraft(value), { initialProps: { value: initial } });
}

describe("черновик поля", () => {
  it("вне поля повторяет значение из кэша", () => {
    const { result, rerender } = setup("2026-09-11");
    rerender({ value: "2026-09-12" });
    expect(result.current.draft).toBe("2026-09-12");
  });

  it("пока Мастер в поле и печатает, пришедшее извне значение набранное не затирает", () => {
    const { result, rerender } = setup("100");
    act(() => result.current.hold());
    act(() => result.current.setDraft("150"));
    rerender({ value: "200" });
    expect(result.current.draft).toBe("150");
    act(() => result.current.release());
    expect(result.current.draft).toBe("150");
  });

  it("стоял в поле, но не правил — на уходе подставляется пришедшее", () => {
    const { result, rerender } = setup("100");
    act(() => result.current.hold());
    rerender({ value: "200" });
    expect(result.current.draft).toBe("100");
    act(() => result.current.release());
    expect(result.current.draft).toBe("200");
  });

  it("после ухода снова следует за кэшем — в том числе за своим же сохранённым значением", () => {
    const { result, rerender } = setup("100");
    act(() => result.current.hold());
    act(() => result.current.setDraft("150"));
    act(() => result.current.release());
    rerender({ value: "150" });
    rerender({ value: "175" });
    expect(result.current.draft).toBe("175");
  });
});

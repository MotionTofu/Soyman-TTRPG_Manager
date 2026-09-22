// @vitest-environment jsdom
// Read-only contract of the shared sheet (phase D2.1, scenario 4): with
// readOnly and no callbacks the sheet renders values but exposes no
// mutation controls. The positive control (with onQuickUpdate) proves the
// fixture really renders and the gates below are not vacuous.
import { describe, expect, it, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DndCharacterView } from "../components/dnd/DndCharacterForm";
import { emptyDndCharacter } from "../../../shared/src/dnd/normalize";

beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      value: () => ({
        matches: false,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  }
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const value = {
  ...emptyDndCharacter(),
  characterName: "Мордекай",
  hitPointsCurrent: "18",
};

describe("shared sheet read-only contract", () => {
  it("renders values without mutation controls", () => {
    render(
      <MemoryRouter>
        <DndCharacterView value={value} portraitUrl={null} readOnly />
      </MemoryRouter>
    );
    expect(screen.getAllByText("Мордекай").length).toBeGreaterThan(0);
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Хиты — изменить" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Отдых" })).toBeNull();
    expect(screen.queryByDisplayValue("Мордекай")).toBeNull();
    expect(screen.queryByText("Редактировать")).toBeNull();
  });

  it("same fixture with onQuickUpdate exposes the HP control (gates work)", () => {
    render(
      <MemoryRouter>
        <DndCharacterView value={value} portraitUrl={null} onQuickUpdate={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: "Хиты — изменить" })).toBeTruthy();
  });
});

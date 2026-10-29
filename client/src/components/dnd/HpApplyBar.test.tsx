// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { emptyDndCharacter } from "@shared/dnd/normalize";
import type { DndCharacterData } from "../../types";
import { HpApplyBar } from "./SheetVitals";

afterEach(cleanup);

function Harness({ initial }: { initial: Partial<DndCharacterData> }) {
  const [value, setValue] = useState<DndCharacterData>({ ...emptyDndCharacter(), ...initial });
  return <HpApplyBar value={value} onQuickUpdate={(p) => setValue((v) => ({ ...v, ...p }))} />;
}
const amount = (n: string) => fireEvent.change(screen.getByLabelText("Урон или лечение"), { target: { value: n } });
const readout = () => screen.getByTitle(/ручная правка/).textContent;

describe("блок хитов листа", () => {
  it("урон сначала снимает временные, лечение упирается в максимум, отмена возвращает", () => {
    render(<Harness initial={{ hitPointsCurrent: "20", hitPointMax: "30", hitPointsTemp: "5" }} />);
    amount("8");
    fireEvent.click(screen.getByRole("button", { name: "Урон" }));
    expect(readout()).toBe("17/ 30");
    amount("50");
    fireEvent.click(screen.getByRole("button", { name: "Лечение" }));
    expect(readout()).toBe("30/ 30");
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(readout()).toBe("17/ 30");
  });
});

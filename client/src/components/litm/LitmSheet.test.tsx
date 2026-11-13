// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { emptyCharacter } from "./LitMCharacterForm";
import { LitmSheet } from "./LitmSheet";

const hero = () => {
  const v = emptyCharacter();
  v.characterName = "Азура";
  v.themes[0] = { ...v.themes[0], power: "origin", themeType: "Devotion", name: "Наша деревня", powerTags: ["заботливость"], weaknessTags: ["мои ровесники"], scratchedTags: ["заботливость"], quest: "Никто не останется без защиты" };
  return v;
};
const html = (edit: boolean) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LitmSheet value={hero()} edit={edit} onChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("лист героя LitM в «Д»", () => {
  it("просмотр: тег-название, вычеркнутое, квест; без полей правки", () => {
    const h = html(false);
    expect(h).toContain('class="lb-tg is-title"');
    expect(h).toContain('class="lb-tg is-x"');
    expect(h).toContain("Квест: «Никто не останется без защиты»");
    expect(h).not.toContain("+ тег силы");
    expect(h).not.toContain("Обещание");
  });

  it("правка на месте: поля в карте, пустое — строкой «+ Поле»", () => {
    const h = html(true);
    expect(h).toContain('value="Наша деревня"');
    expect(h).toContain("+ тег силы");
    expect(h).toMatch(/<b>\+<\/b> Обещание<small>пусто<\/small>/);
  });
});

// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import source from "../../../extension/markdown.js?raw";

// Перевод выделения в Markdown живёт в расширении браузера (extension/markdown.js,
// гриллинг 2026-11-05 Q6) и подключается в чужую страницу как обычный скрипт.
// Здесь он грузится тем же способом и проверяется на типичной вёрстке вики.

declare global {
  var soymanSelectionMarkdown: (root: Node) => string;
}

beforeAll(() => {
  new Function(source)();
});

function md(html: string): string {
  const box = document.createElement("div");
  box.innerHTML = html;
  return globalThis.soymanSelectionMarkdown(box);
}

describe("extension selection → Markdown", () => {
  it("keeps paragraphs, bold and italic, drops layout whitespace", () => {
    expect(md(`<p>Обсерватория стоит на <b>скальном</b>
      выступе.</p>\n\n<p>Купол <em>потемнел</em> .</p>`))
      .toBe("Обсерватория стоит на **скальном** выступе.\n\nКупол *потемнел* .");
  });

  it("writes headings and lists, numbered from the list's start", () => {
    expect(md("<h2>Смотритель</h2><ul><li>фонарь</li><li>колокол</li></ul><ol start='3'><li>раз</li><li>два</li></ol>"))
      .toBe("## Смотритель\n\n- фонарь\n- колокол\n\n3. раз\n4. два");
  });

  it("turns a statblock table into a Markdown table", () => {
    expect(md(`<table><thead><tr><th>СИЛ</th><th>ЛОВ</th></tr></thead>
      <tbody><tr><td>18 (+4)</td><td>12 | 13</td></tr></tbody></table>`))
      .toBe("| СИЛ | ЛОВ |\n| --- | --- |\n| 18 (+4) | 12 \\| 13 |");
  });

  it("ignores scripts, buttons, images and hidden parts", () => {
    expect(md(`<p>Текст<script>x()</script><button>Править</button><img alt="картинка"><span aria-hidden="true">¶</span></p>`))
      .toBe("Текст");
  });

  it("quotes blockquotes line by line and keeps line breaks", () => {
    expect(md("<blockquote><p>Не поднимайтесь<br>до третьего удара.</p></blockquote>"))
      .toBe("> Не поднимайтесь\n> до третьего удара.");
  });
});

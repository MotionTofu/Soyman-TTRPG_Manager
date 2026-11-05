// Выделение страницы → Markdown (гриллинг 2026-11-05, Q6): абзацы, списки,
// жирный и курсив, таблицы, заголовки, цитаты. Ссылки и картинки — текстом
// или никак: в описании сущности они не нужны.
// Подключается в страницу перед capture.js; проверка — client/src/webCapture.
(function () {
  const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "NAV", "FIGURE",
    "FIGCAPTION", "DL", "DT", "DD", "ADDRESS", "DETAILS", "SUMMARY", "CAPTION"]);
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON", "INPUT", "SELECT", "TEXTAREA",
    "IFRAME", "IMG", "PICTURE", "VIDEO", "AUDIO", "CANVAS", "OBJECT", "EMBED"]);

  const oneLine = (s) => s.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();

  function wrap(mark, s) {
    const t = s.trim();
    if (!t) return s;
    const lead = s.match(/^\s*/)[0];
    const trail = s.match(/\s*$/)[0];
    return `${lead ? " " : ""}${mark}${t}${mark}${trail ? " " : ""}`;
  }

  function cells(row) {
    return Array.from(row.children)
      .filter((c) => c.nodeName === "TD" || c.nodeName === "TH")
      .map((c) => oneLine(kids(c)).replace(/\|/g, "\\|"));
  }

  function table(node) {
    const rows = Array.from(node.querySelectorAll("tr")).filter((r) => r.closest("table") === node || node.nodeName !== "TABLE");
    const grid = rows.map(cells).filter((r) => r.length);
    if (!grid.length) return block(kids(node));
    const width = Math.max(...grid.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill("")];
    const line = (r) => `| ${pad(r).join(" | ")} |`;
    return block([line(grid[0]), line(Array(width).fill("---")), ...grid.slice(1).map(line)].join("\n"));
  }

  function list(node) {
    let n = Number(node.getAttribute && node.getAttribute("start")) || 1;
    const items = Array.from(node.children).filter((c) => c.nodeName === "LI").map((li) => {
      const mark = node.nodeName === "OL" ? `${n++}.` : "-";
      const body = kids(li).trim().replace(/\n{2,}/g, "\n").replace(/\n/g, "\n  ");
      return `${mark} ${body}`;
    });
    return block(items.join("\n"));
  }

  const block = (s) => `\n\n${s.trim()}\n\n`;
  const kids = (node) => Array.from(node.childNodes).map(conv).join("");

  function conv(node) {
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== 1 && node.nodeType !== 11) return "";
    const tag = node.nodeName;
    if (SKIP.has(tag)) return "";
    if (node.nodeType === 1 && (node.hidden || node.getAttribute("aria-hidden") === "true")) return "";
    switch (tag) {
      case "BR": return "\n";
      case "STRONG": case "B": return wrap("**", kids(node));
      case "EM": case "I": return wrap("*", kids(node));
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
        const text = oneLine(kids(node));
        return text ? block(`${"#".repeat(Number(tag[1]))} ${text}`) : "";
      }
      case "UL": case "OL": return list(node);
      case "LI": return block(`- ${kids(node).trim()}`);
      case "TABLE": case "TBODY": case "THEAD": case "TFOOT": return table(node);
      case "TR": return block(cells(node).join(" | "));
      case "BLOCKQUOTE": return block(norm(kids(node)).split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
      case "PRE": return block("```\n" + node.textContent.replace(/\n$/, "") + "\n```");
      case "HR": return block("---");
      default: return BLOCK.has(tag) ? block(kids(node)) : kids(node);
    }
  }

  function norm(s) {
    return s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /** root — фрагмент или элемент с содержимым выделения. */
  globalThis.soymanSelectionMarkdown = (root) => norm(conv(root));
})();

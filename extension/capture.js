// Снимок выделения на странице: Markdown, адрес, заголовок вкладки и главный
// заголовок страницы (им SoyMan предзаполнит название, Q19). Последнее
// выражение файла — его результат для chrome.scripting.executeScript.
(() => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const box = document.createElement("div");
  for (let i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
  const text = globalThis.soymanSelectionMarkdown(box) || sel.toString().trim();
  if (!text) return null;
  const h1 = document.querySelector("h1");
  return {
    text,
    url: location.href,
    page_title: document.title || "",
    heading: h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "",
  };
})();

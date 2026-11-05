// SoyMan — захват с сайтов (гриллинг 2026-11-05; .scratch/web-sources/extension-decisions.md).
// ПКМ по выделению или Alt+Shift+S → фрагмент в очередь → во Входящие SoyMan.
// Очередь живёт в chrome.storage: SoyMan закрыт — фрагмент ждёт (Q3), сервер
// не плодит копий при повторе (client_id).

const MENU_ID = "soyman-inbox";
const DEFAULT_BASE = "http://127.0.0.1:3001";
const COLORS = { queue: "#C2105A", ok: "#1E8E3E", warn: "#C2105A" };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "Во входящие SoyMan", contexts: ["selection"] });
  void refreshBadge();
});
chrome.runtime.onStartup.addListener(() => void flush());
chrome.alarms.create("flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "flush") void flush(); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab) void capture(tab, info.selectionText);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "to-inbox" && tab) void capture(tab, "");
});
// Окошко просит отправить очередь сейчас (после подключения или при открытии).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "flush") { flush().then(() => reply(true)); return true; }
  return false;
});

async function store() {
  return chrome.storage.local.get({ key: "", base: DEFAULT_BASE, queue: [], disconnected: false });
}

async function capture(tab, fallbackText) {
  let snap = null;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["markdown.js", "capture.js"] });
    snap = results && results[0] ? results[0].result : null;
  } catch {
    // Страница не пускает скрипты (chrome://, магазин, просмотр PDF): берём
    // текст, который отдало само меню, без разметки.
  }
  if (!snap && fallbackText && fallbackText.trim()) {
    snap = { text: fallbackText.trim(), url: tab.url || "", page_title: tab.title || "", heading: "" };
  }
  if (!snap || !/^https?:\/\//i.test(snap.url)) return flash("?", COLORS.warn);
  const { queue } = await store();
  queue.push({ ...snap, client_id: crypto.randomUUID(), captured_at: new Date().toISOString() });
  await chrome.storage.local.set({ queue });
  const sent = await flush();
  if (sent) await flash("✓", COLORS.ok);
}

let flushing = null;
/** Отправить очередь. true — хотя бы один фрагмент дошёл. Одна отправка за раз. */
function flush() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush() {
  const { key, base, queue, disconnected } = await store();
  if (!key || disconnected || !queue.length) { await refreshBadge(); return false; }
  const done = new Set();
  for (const item of queue) {
    let res;
    try {
      res = await fetch(`${base}/api/web-capture/ext/inbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(item),
      });
    } catch {
      break; // SoyMan не запущен — остальное подождёт следующей попытки.
    }
    if (res.ok) { done.add(item.client_id); continue; }
    if (res.status === 401) {
      // Ключ отключили в SoyMan. Больше не стучимся: каждая неудача тратит лимит попыток.
      await chrome.storage.local.set({ disconnected: true });
      break;
    }
    if (res.status === 400) { done.add(item.client_id); continue; } // сервер такой фрагмент не примет никогда
    break; // 5xx, 429 — повторим позже
  }
  // Перечитать: пока шла отправка, в очередь могли добавить новое.
  const fresh = (await store()).queue.filter((q) => !done.has(q.client_id));
  await chrome.storage.local.set({ queue: fresh });
  await refreshBadge();
  return done.size > 0;
}

async function refreshBadge() {
  const { key, queue, disconnected } = await store();
  if (key && disconnected) return setBadge("!", COLORS.warn);
  return setBadge(queue.length ? String(queue.length) : "", COLORS.queue);
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
  await chrome.action.setBadgeText({ text });
}

async function flash(text, color) {
  await setBadge(text, color);
  setTimeout(() => void refreshBadge(), 1500);
}

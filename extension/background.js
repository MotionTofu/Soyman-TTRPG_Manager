// SoyMan — захват с сайтов (гриллинг 2026-11-05; .scratch/web-sources/extension-decisions.md).
// ПКМ по выделению → SoyMan → «Во входящие» (или Alt+Shift+S): фрагмент в
// очередь → во Входящие SoyMan. Очередь живёт в chrome.storage: SoyMan закрыт —
// фрагмент ждёт (Q3), сервер не плодит копий при повторе (client_id).
// «Разобрать сейчас…» (поставка 2) открывает окно parse.html: сущность
// создаётся сразу, после — уведомление «Создано» с «Открыть в SoyMan» (Q21).

const MENU = { root: "soyman", inbox: "soyman-inbox", parse: "soyman-parse" };
// Адрес подставляется при подключении (popup.js); это — запасной.
const DEFAULT_BASE = "http://127.0.0.1:4732";
const COLORS = { queue: "#C2105A", ok: "#1E8E3E", warn: "#C2105A" };

chrome.runtime.onInstalled.addListener(() => {
  // При обновлении старые пункты остаются — пересобрать меню целиком.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.root, title: "SoyMan", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.inbox, parentId: MENU.root, title: "Во входящие", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.parse, parentId: MENU.root, title: "Разобрать сейчас…", contexts: ["selection"] });
  });
  void refreshBadge();
});
chrome.runtime.onStartup.addListener(() => void flush());
chrome.alarms.create("flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "flush") void flush(); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === MENU.inbox) void capture(tab, info.selectionText);
  if (info.menuItemId === MENU.parse) void parseNow(tab, info.selectionText);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "to-inbox" && tab) void capture(tab, "");
});
// Окошко просит отправить очередь сейчас (после подключения или при открытии);
// окно разбора отдаёт фрагмент во Входящие или сообщает о созданной сущности.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return false;
  if (msg.type === "flush") { flush().then(() => reply(true)); return true; }
  if (msg.type === "enqueue") { enqueue(msg.snap).then(() => reply(true)); return true; }
  if (msg.type === "created") { notifyCreated(msg.entity); reply(true); return false; }
  if (msg.type === "open") { void openEntity(msg.kind, msg.id); reply(true); return false; }
  return false;
});
chrome.notifications.onClicked.addListener((id) => void openCreated(id));
chrome.notifications.onButtonClicked.addListener((id) => void openCreated(id));

async function store() {
  return chrome.storage.local.get({ key: "", base: DEFAULT_BASE, queue: [], disconnected: false });
}

/** Выделение на вкладке: Markdown, адрес, заголовки. null — снять нечего. */
async function snapshot(tab, fallbackText) {
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
  if (!snap || !/^https?:\/\//i.test(snap.url)) return null;
  return { ...snap, captured_at: new Date().toISOString() };
}

async function capture(tab, fallbackText) {
  const snap = await snapshot(tab, fallbackText);
  if (!snap) return flash("?", COLORS.warn);
  const sent = await enqueue(snap);
  if (sent) await flash("✓", COLORS.ok);
}

async function enqueue(snap) {
  const { queue } = await store();
  queue.push({ ...snap, client_id: crypto.randomUUID() });
  await chrome.storage.local.set({ queue });
  return flush();
}

// Окно разбора получает фрагмент через storage.session: адрес окна не
// подходит для 200 тысяч знаков, а сессионное хранилище чистится само.
async function parseNow(tab, fallbackText) {
  const snap = await snapshot(tab, fallbackText);
  if (!snap) return flash("?", COLORS.warn);
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [`draft:${id}`]: snap });
  await chrome.windows.create({ url: `parse.html?id=${id}`, type: "popup", width: 420, height: 700, focused: true });
}

function notifyCreated(entity) {
  chrome.notifications.create(`created:${entity.kind}:${entity.id}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `Создано: ${entity.name}`,
    message: `${entity.label} · ${entity.setting}`,
    buttons: [{ title: "Открыть в SoyMan" }],
  });
}

async function openCreated(notificationId) {
  const [tag, kind, rawId] = notificationId.split(":");
  if (tag !== "created") return;
  chrome.notifications.clear(notificationId);
  await openEntity(kind, Number(rawId));
}

async function openEntity(kind, id) {
  const { key, base } = await store();
  try {
    const res = await fetch(`${base}/api/web-capture/ext/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ kind, id }),
    });
    const body = await res.json();
    // SoyMan запущен не как приложение (из репозитория) — окна у него нет.
    if (res.ok && !body.opened) await chrome.tabs.create({ url: `${base}${body.route}` });
  } catch {
    // SoyMan закрыли между созданием и щелчком: открывать нечего.
  }
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

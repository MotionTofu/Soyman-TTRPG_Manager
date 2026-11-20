// Окошко у значка (макет Web-Popup, состояния 4–6): подключение кодом,
// состояние связи, очередь, горячая клавиша.
// Установленный SoyMan слушает 4732, запущенный из репозитория — 3001.
// Поле адреса пустое — подключение пробует оба.
const CANDIDATES = ["http://127.0.0.1:4732", "http://127.0.0.1:3001"];
const DEFAULT_BASE = CANDIDATES[0];
const $ = (id) => document.getElementById(id);

async function store() {
  return chrome.storage.local.get({ key: "", base: DEFAULT_BASE, queue: [], disconnected: false });
}

function show(id) {
  $("pair").hidden = id !== "pair";
  $("status").hidden = id !== "status";
}

async function render() {
  const { key, base, queue, disconnected } = await store();
  $("base").value = key ? base : "";
  if (!key || disconnected) {
    $("head").textContent = "Первый запуск";
    $("pair-why").hidden = !(key && disconnected);
    show("pair");
    $("code").focus();
    return;
  }
  $("head").textContent = "SoyMan";
  show("status");
  $("queued").textContent = String(queue.length);
  $("queue").innerHTML = "";
  for (const item of queue.slice(0, 5)) {
    const li = document.createElement("li");
    li.textContent = item.text.replace(/[*_#>|`]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    $("queue").append(li);
  }
  const commands = await chrome.commands.getAll();
  const hotkey = commands.find((c) => c.name === "to-inbox");
  $("hotkey").textContent = hotkey && hotkey.shortcut ? hotkey.shortcut : "не задана";
  try {
    const res = await fetch(`${base}/api/web-capture/ext/status`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) {
      await chrome.storage.local.set({ disconnected: true });
      return render();
    }
    const body = await res.json();
    $("inbox").textContent = String(body.inbox);
    $("state").hidden = false;
    $("offline").hidden = true;
    $("note").textContent = "";
    if (queue.length) chrome.runtime.sendMessage({ type: "flush" }).then(() => refreshQueue());
  } catch {
    $("state").hidden = true;
    $("offline").hidden = false;
    $("note").textContent = "НЕТ СВЯЗИ";
    $("inbox").textContent = "—";
  }
}

async function refreshQueue() {
  const { queue } = await store();
  $("queued").textContent = String(queue.length);
  if (!queue.length) $("queue").innerHTML = "";
}

$("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("pair-error");
  error.hidden = true;
  const typed = $("base").value.trim().replace(/\/+$/, "");
  let refusal = "";
  // Код выдал один из запущенных SoyMan — подходит тот, что его принял.
  for (const base of typed ? [typed] : CANDIDATES) {
    let res;
    try {
      res = await fetch(`${base}/api/web-capture/ext/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: $("code").value, label: browserName() }),
      });
    } catch {
      continue; // по этому адресу никто не слушает
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { refusal = body.error || "Код не подошёл"; continue; }
    await chrome.storage.local.set({ key: body.key, base, disconnected: false });
    await chrome.runtime.sendMessage({ type: "flush" });
    return render();
  }
  error.textContent = refusal || `SoyMan не отвечает${typed ? ` по адресу ${typed}` : ""}. Он запущен?`;
  error.hidden = false;
});

$("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

$("disconnect").addEventListener("click", async (e) => {
  e.preventDefault();
  const { key, base } = await store();
  try {
    await fetch(`${base}/api/web-capture/ext/disconnect`, { method: "POST", headers: { Authorization: `Bearer ${key}` } });
  } catch {
    // SoyMan не запущен — ключ забываем здесь; в SoyMan его можно снять в настройках.
  }
  await chrome.storage.local.set({ key: "", disconnected: false });
  await chrome.action.setBadgeText({ text: "" });
  await render();
});

function browserName() {
  const ua = navigator.userAgent;
  const name = /YaBrowser/.test(ua) ? "Яндекс Браузер" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : "Chrome";
  return `${name} · этот компьютер`;
}

void render();

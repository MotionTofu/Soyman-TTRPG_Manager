// Окно «Разобрать сейчас…» (макет Web-Popup, состояния 1, 2, 4; Q10, Q11,
// Q19–Q21). Фрагмент кладёт сюда background.js через storage.session.
// Создать сущность — сразу в SoyMan; не вышло или передумал — во Входящие.
const $ = (id) => document.getElementById(id);
const draftKey = `draft:${new URLSearchParams(location.search).get("id")}`;
const KIND_LABEL = { being: "Существо", location: "Место", community: "Сообщество", artifact: "Артефакт" };
let snap = null;
let conn = null;
let suggested = "";

function view(id) {
  for (const v of ["loading", "form", "off"]) $(v).hidden = v !== id;
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Название по умолчанию (Q19): главный заголовок, иначе заголовок вкладки без имени сайта. */
function defaultName(s) {
  const heading = s.heading.trim();
  return (heading || s.page_title.split(/\s+[—|–-]\s+/)[0].trim()).slice(0, 120);
}

function offline(head, text, note = "НЕТ СВЯЗИ") {
  $("off-head").textContent = head;
  if (text) $("off-text").textContent = text;
  $("note").textContent = note;
  view("off");
}

async function api(path, init = {}) {
  return fetch(`${conn.base}/api/web-capture/ext${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.key}` },
  });
}

async function start() {
  snap = (await chrome.storage.session.get(draftKey))[draftKey];
  if (!snap) return window.close();
  conn = await chrome.storage.local.get({ key: "", base: "", disconnected: false, lastKind: "being", lastSetting: 0 });
  if (!conn.key || conn.disconnected) {
    return offline("Расширение не подключено", "Подключите его в окошке у значка SoyMan. Фрагмент подождёт в очереди и уйдёт во Входящие после подключения.", "НЕ ПОДКЛЮЧЕНО");
  }
  let settings;
  try {
    const res = await api("/settings");
    if (res.status === 401) {
      await chrome.storage.local.set({ disconnected: true });
      return offline("Подключение снято в SoyMan", "Подключите расширение заново в окошке у значка. Фрагмент подождёт в очереди.", "НЕ ПОДКЛЮЧЕНО");
    }
    settings = await res.json();
  } catch {
    return offline("SoyMan не запущен");
  }
  if (!settings.length) return offline("В SoyMan нет сеттингов", "Сущность живёт в сеттинге — создайте его в SoyMan. А фрагмент пока можно положить во Входящие.", "");

  $("src-title").textContent = snap.page_title || host(snap.url);
  $("src-meta").textContent = `${host(snap.url)} · ${new Date(snap.captured_at).toLocaleDateString("ru-RU")}`;
  const kind = document.querySelector(`input[name=kind][value=${KIND_LABEL[conn.lastKind] ? conn.lastKind : "being"}]`);
  kind.checked = true;
  for (const s of settings) $("setting").append(new Option(s.name, String(s.id)));
  if (settings.some((s) => s.id === conn.lastSetting)) $("setting").value = String(conn.lastSetting);
  suggested = defaultName(snap);
  $("name").value = suggested;
  $("name-tag").hidden = !suggested;
  const paragraphs = snap.text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  $("preview-label").textContent = `В описание · ${paragraphs} ${plural(paragraphs, "абзац", "абзаца", "абзацев")}`;
  $("preview").textContent = snap.text;
  view("form");
  $("name").focus();
  $("name").select();
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  return m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}

function showDup(duplicates) {
  const setting = $("setting").selectedOptions[0].textContent;
  $("dup-head").textContent = `Уже есть в «${setting}»:`;
  $("dup-list").innerHTML = "";
  for (const d of duplicates) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.type = "button";
    open.title = "Открыть в SoyMan";
    open.innerHTML = `<i style="--g:url(glyphs/${d.kind}.webp)"></i><span></span><small class="mono"></small>`;
    open.querySelector("span").textContent = d.name;
    open.querySelector("small").textContent = d.label.toUpperCase();
    open.addEventListener("click", () => chrome.runtime.sendMessage({ type: "open", kind: d.kind, id: d.id }));
    li.append(open);
    $("dup-list").append(li);
  }
  // Дополнить существующую — поставка 4; пока советуем отложить во Входящие.
  $("dup").hidden = false;
  $("create").hidden = true;
  $("force").hidden = false;
  $("to-inbox").className = "primary";
}

function clearDup() {
  if ($("dup").hidden) return;
  $("dup").hidden = true;
  $("create").hidden = false;
  $("force").hidden = true;
  $("to-inbox").className = "btn left";
}

async function create(force) {
  const name = $("name").value.trim();
  if (!name) return $("name").focus();
  const kind = document.querySelector("input[name=kind]:checked").value;
  const settingId = Number($("setting").value);
  setBusy(true);
  $("error").hidden = true;
  try {
    const res = await api("/entities", {
      method: "POST",
      body: JSON.stringify({ ...snap, kind, setting_id: settingId, name, force }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) return showDup(body.duplicates);
    if (res.status === 401) {
      await chrome.storage.local.set({ disconnected: true });
      return offline("Подключение снято в SoyMan", "Подключите расширение заново в окошке у значка. Фрагмент подождёт в очереди.", "НЕ ПОДКЛЮЧЕНО");
    }
    if (!res.ok) throw new Error(body.error || "SoyMan не создал сущность");
    await chrome.storage.local.set({ lastKind: kind, lastSetting: settingId });
    await chrome.runtime.sendMessage({ type: "created", entity: body });
    await done();
  } catch (e) {
    if (e instanceof TypeError) return offline("SoyMan не запущен", "Он закрылся, пока окно было открыто. Фрагмент можно положить в очередь — уйдёт во Входящие при запуске.");
    $("error").textContent = e.message;
    $("error").hidden = false;
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  for (const id of ["create", "force", "to-inbox"]) $(id).disabled = busy;
  $("create").textContent = busy ? "Создаю…" : "Создать";
}

async function toInbox() {
  await chrome.runtime.sendMessage({ type: "enqueue", snap });
  await done();
}

async function done() {
  await chrome.storage.session.remove(draftKey);
  window.close();
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); void create(false); });
$("force").addEventListener("click", () => void create(true));
$("to-inbox").addEventListener("click", () => void toInbox());
$("to-queue").addEventListener("click", () => void toInbox());
$("name").addEventListener("input", () => { $("name-tag").hidden = $("name").value !== suggested; clearDup(); });
$("setting").addEventListener("change", clearDup);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") void done(); });

void start();

// Окно «Разобрать сейчас…» (макет Web-Popup, состояния 1, 2, 4; Q10, Q11,
// Q19–Q21). Фрагмент кладёт сюда background.js через storage.session.
// Создать сущность — сразу в SoyMan; не вышло или передумал — во Входящие.
// Вкладка «Верстак» (поставка 3, В2) кладёт фрагмент в черновик печати.
const $ = (id) => document.getElementById(id);
const draftKey = `draft:${new URLSearchParams(location.search).get("id")}`;
const KIND_LABEL = { being: "Существо", location: "Место", community: "Сообщество", artifact: "Артефакт" };
let snap = null;
let conn = null;
let suggested = "";
let mode = "entity";
let hasSettings = false;

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
  conn = await chrome.storage.local.get({ key: "", base: "", disconnected: false, lastKind: "being", lastSetting: 0, lastMode: "entity" });
  if (!conn.key || conn.disconnected) {
    return offline("Расширение не подключено", "Подключите его в окошке у значка SoyMan. Фрагмент подождёт в очереди и уйдёт во Входящие после подключения.", "НЕ ПОДКЛЮЧЕНО");
  }
  let settings, status;
  try {
    const [res, st] = await Promise.all([api("/settings"), api("/status")]);
    if (res.status === 401) return unpaired();
    settings = await res.json();
    status = st.ok ? await st.json() : {};
  } catch {
    return offline("SoyMan не запущен");
  }
  // Без сеттингов сущность не создать, а на верстак положить можно.
  hasSettings = settings.length > 0;
  $("mode-entity").disabled = !hasSettings;
  $("mode-entity").title = hasSettings ? "" : "В SoyMan нет сеттингов — сущность живёт в сеттинге";
  showCount(status.workbench);

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
  $("wb-title").value = snap.heading.trim();
  $("wb-title-tag").hidden = !snap.heading.trim();
  $("paper-text").textContent = snap.text;
  syncPaper();
  view("form");
  setMode(hasSettings ? conn.lastMode : "wb");
}

function setMode(next) {
  mode = next === "wb" || !hasSettings ? "wb" : "entity";
  for (const b of document.querySelectorAll(".seg button")) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
  $("pane-entity").hidden = mode !== "entity";
  $("pane-wb").hidden = mode !== "wb";
  $("create").hidden = mode !== "entity" || !$("dup").hidden;
  $("force").hidden = mode !== "entity" || $("dup").hidden;
  $("to-wb").hidden = mode !== "wb";
  $("to-inbox").className = mode === "entity" && !$("dup").hidden ? "primary" : "btn left";
  $("error").hidden = true;
  const field = mode === "wb" ? $("wb-title") : $("name");
  field.focus();
  field.select();
}

function syncPaper() {
  $("paper-title").textContent = $("wb-title").value.trim();
}

function showCount(n) {
  if (typeof n !== "number") return;
  $("wb-count").textContent = n ? `На верстаке ${n} ${plural(n, "блок", "блока", "блоков")}` : "Верстак пуст";
  $("wb-count").hidden = false;
}

async function unpaired() {
  await chrome.storage.local.set({ disconnected: true });
  return offline("Подключение снято в SoyMan", "Подключите расширение заново в окошке у значка. Фрагмент подождёт в очереди.", "НЕ ПОДКЛЮЧЕНО");
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
    if (res.status === 401) return unpaired();
    if (!res.ok) throw new Error(body.error || "SoyMan не создал сущность");
    await chrome.storage.local.set({ lastKind: kind, lastSetting: settingId, lastMode: "entity" });
    await chrome.runtime.sendMessage({ type: "created", entity: body });
    await done();
  } catch (e) {
    failed(e);
  } finally {
    setBusy(false);
  }
}

function failed(e) {
  if (e instanceof TypeError) return offline("SoyMan не запущен", "Он закрылся, пока окно было открыто. Фрагмент можно положить в очередь — уйдёт во Входящие при запуске.");
  $("error").textContent = e.message;
  $("error").hidden = false;
}

async function toWorkbench() {
  setBusy(true);
  $("error").hidden = true;
  try {
    // client_id — номер окна: повтор после обрыва не кладёт второй блок.
    const res = await api("/workbench", {
      method: "POST",
      body: JSON.stringify({
        ...snap, client_id: draftKey.slice(6), title: $("wb-title").value.trim(), show_source: $("wb-source").checked,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) return unpaired();
    if (!res.ok) throw new Error(body.error || "SoyMan не принял фрагмент");
    await chrome.storage.local.set({ lastMode: "wb" });
    await chrome.runtime.sendMessage({ type: "workbench", count: body.count, title: $("wb-title").value.trim() || snap.page_title });
    await done();
  } catch (e) {
    failed(e);
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  for (const id of ["create", "force", "to-inbox", "to-wb"]) $(id).disabled = busy;
  $("create").textContent = busy ? "Создаю…" : "Создать";
  $("to-wb").textContent = busy ? "Кладу…" : "На верстак";
}

async function toInbox() {
  await chrome.runtime.sendMessage({ type: "enqueue", snap });
  await done();
}

async function done() {
  await chrome.storage.session.remove(draftKey);
  window.close();
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); void (mode === "wb" ? toWorkbench() : create(false)); });
for (const b of document.querySelectorAll(".seg button")) b.addEventListener("click", () => setMode(b.dataset.mode));
$("wb-title").addEventListener("input", () => { $("wb-title-tag").hidden = $("wb-title").value !== snap.heading.trim() || !snap.heading.trim(); syncPaper(); });
$("force").addEventListener("click", () => void create(true));
$("to-inbox").addEventListener("click", () => void toInbox());
$("to-queue").addEventListener("click", () => void toInbox());
$("name").addEventListener("input", () => { $("name-tag").hidden = $("name").value !== suggested; clearDup(); });
$("setting").addEventListener("change", clearDup);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") void done(); });

void start();

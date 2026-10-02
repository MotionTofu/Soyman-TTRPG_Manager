import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteFileWithChoice } from "../api/client";
import { useAfterWrite, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { resolveEntityMapLabels } from "../api/resolveEntity";
import { Modal } from "./Modal";
import { DETAIL_ROUTES, ENTITY_TYPE_LABELS } from "../entityTypes";
import { LocationCascadePicker } from "./LocationCascadePicker";
import { SendMapToSessionModal } from "./SendMapToSessionModal";
import { addToBag } from "../bag";
import { NavIcon } from "./NavIcons";
import { PlaceCard } from "./PlaceCard";
import { CreatureCardLoader } from "./CreatureCard";
import { PinBoard, type BoardPin } from "./PinBoard";
import { useMapToast } from "../hooks/useMapToast";
import { useConfirm } from "../hooks/useConfirm";
import type { LocationPin, SettingLocation } from "../types";

// Карта места (доски 29–31): ядро «картинка + пины» (PinBoard) плюс то, что
// знает только место — подписи сущностей, карточка выбранного пина, «В
// сессию», перенос карты, настройки зума и вложенные места «Не на карте».

interface Props {
  locationId: number;
  locationName: string;
  settingId: number | null;
  mapImageUrl: string | null;
  pins: LocationPin[];
  mapMaxZoom: number | null;
  mapStartZoom: number | null;
  mapGotoZoom: number | null;
  mapLabelsAlways: number;
  // Every other location in the same setting — feeds the "Перенести карту"
  // target picker. Omitted (or empty) simply hides that button.
  otherLocations?: SettingLocation[];
}

interface MapPin extends BoardPin {
  target_type: string;
  target_id: number;
}

const MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 6;
const DEFAULT_START_ZOOM = 1;
const DEFAULT_GOTO_ZOOM = 3;

// Группы списка пинов справа от карты (разбор 2026-10-02, Q3).
const PIN_GROUPS = [
  { key: "location", label: "Места" },
  { key: "being", label: "Существа" },
  { key: "character", label: "Персонажи" },
  { key: "community", label: "Сообщества" },
  { key: "artifact", label: "Предметы" },
  { key: "other", label: "Другое" },
];

const WORDS = { title: "Карта", acc: "карту", on: "на карте", to: "на карту", away: "Карта открыта на весь экран." };

export function LocationMap({
  locationId,
  locationName,
  settingId,
  mapImageUrl,
  pins,
  mapMaxZoom,
  mapStartZoom,
  mapGotoZoom,
  mapLabelsAlways,
  otherLocations,
}: Props) {
  const [resolved, setResolved] = useState<MapPin[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({
    maxZoom: "",
    startZoom: "",
    gotoZoom: "",
    labelsAlways: false,
  });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<number | null>(null);
  const [transferKeepCopy, setTransferKeepCopy] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirm();
  const [toastNode, showToast] = useMapToast();
  const afterWrite = useAfterWrite();
  // Карта и пины лежат в карточке локации. Перенос карты задевает и вторую
  // локацию, поэтому у него своё правило.
  function changed() {
    afterWrite([{ kind: "location", id: locationId }]);
  }

  // В списке — полное имя: подпись пина на карте бывает короткой («Вилла»,
  // «Мирт»), а в списке их несколько и их надо различать.
  const placeNames = new Map((otherLocations ?? []).map((l) => [l.id, l.name]));

  useEffect(() => {
    if (pins.length === 0) {
      setResolved([]);
      return;
    }
    let cancelled = false;
    setPinsLoading(true);
    resolveEntityMapLabels(pins.map((p) => ({ target_type: p.target_type, target_id: p.target_id })))
      .then((results) => {
        if (cancelled) return;
        const labelMap = new Map(results.map((r) => [`${r.target_type}:${r.target_id}`, r.label]));
        const fullMap = new Map(results.map((r) => [`${r.target_type}:${r.target_id}`, r.full_label]));
        setResolved(
          pins.map((p) => {
            const key = `${p.target_type}:${p.target_id}`;
            return {
              id: p.id,
              kind: p.target_type,
              target_type: p.target_type,
              target_id: p.target_id,
              x: p.x,
              y: p.y,
              color: p.color,
              size: p.size,
              border_color: p.border_color,
              label: labelMap.get(key) ?? `${p.target_type} #${p.target_id}`,
              fullLabel:
                (p.target_type === "location" ? placeNames.get(p.target_id) : undefined) ?? fullMap.get(key) ?? undefined,
              typeLabel: ENTITY_TYPE_LABELS[p.target_type] ?? p.target_type,
            };
          })
        );
      })
      .catch((err) => {
        if (!cancelled && err?.name !== "AbortError") {
          console.error("Failed to resolve pin labels:", err);
          showToast("Не удалось загрузить подписи пинов");
        }
      })
      .finally(() => {
        if (!cancelled) setPinsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Имена мест нужны только для списка; перечитывать подписи из-за них незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins]);

  async function uploadMap(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await write.post(`/setting-locations/${locationId}/map`, form, { timeoutMs: 120_000 });
      showToast("Карта загружена");
      changed();
    } catch (e) {
      showSaveError(`Карта не загрузилась: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  async function removeMap() {
    const ok = await confirm({
      title: "Убрать карту?",
      message: `Убрать карту локации «${locationName}» и все пины на ней (${pins.length})?`,
      confirmLabel: "Убрать",
      danger: true,
    });
    if (!ok) return;
    try {
      const deleted = await deleteFileWithChoice(`/setting-locations/${locationId}/map`);
      if (!deleted) return;
      showToast("Карта удалена", () => {
        void write
          .post(`/setting-locations/${locationId}/map/restore`)
          .then(changed)
          .catch((e) => showSaveError(`Карта не вернулась: ${e instanceof Error ? e.message : String(e)}`));
      });
      changed();
    } catch (e) {
      showSaveError(`Карта не удалилась: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function transferMap() {
    if (transferTarget == null) return;
    setTransferring(true);
    try {
      await write.post(`/setting-locations/${locationId}/map/transfer`, {
        targetLocationId: transferTarget,
        keepCopy: transferKeepCopy,
      });
      setTransferOpen(false);
      setTransferTarget(null);
      setTransferKeepCopy(false);
      afterWrite([{ kind: "location" }]);
    } catch {
      showToast("Не удалось перенести карту — возможно, у выбранной локации уже есть своя карта.");
    } finally {
      setTransferring(false);
    }
  }

  function openSettings() {
    setSettingsDraft({
      maxZoom: String(mapMaxZoom ?? DEFAULT_MAX_ZOOM),
      startZoom: String(mapStartZoom ?? DEFAULT_START_ZOOM),
      gotoZoom: String(mapGotoZoom ?? DEFAULT_GOTO_ZOOM),
      labelsAlways: !!mapLabelsAlways,
    });
    setShowSettings(true);
  }

  function parseSettingNumber(value: string, fallback: number): number {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(MIN_ZOOM, n);
  }

  async function saveSettings() {
    try {
      await write.put(`/setting-locations/${locationId}/map-settings`, {
        max_zoom: parseSettingNumber(settingsDraft.maxZoom, DEFAULT_MAX_ZOOM),
        start_zoom: parseSettingNumber(settingsDraft.startZoom, DEFAULT_START_ZOOM),
        goto_zoom: parseSettingNumber(settingsDraft.gotoZoom, DEFAULT_GOTO_ZOOM),
        labels_always: settingsDraft.labelsAlways,
      });
      setShowSettings(false);
      showToast("Настройки карты сохранены");
      changed();
    } catch (e) {
      // Окно настроек остаётся открытым с набранным.
      showSaveError(`Настройки карты не сохранились: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function renderPicked(pin: BoardPin) {
    const p = pin as MapPin;
    if (p.target_type === "location") return <PlaceCard key={p.id} locationId={p.target_id} />;
    if (p.target_type === "being" || p.target_type === "character")
      return <CreatureCardLoader key={p.id} type={p.target_type} id={p.target_id} variant="column" />;
    const route = DETAIL_ROUTES[p.target_type];
    return (
      <div className="location-map-picked__plain">
        <span className="paper-label">{ENTITY_TYPE_LABELS[p.target_type] ?? p.target_type}</span>
        <strong>{p.fullLabel ?? p.label}</strong>
        {route && (
          <button type="button" className="comp-mini" onClick={() => navigate(`${route}/${p.target_id}`)}>
            Открыть ›
          </button>
        )}
      </div>
    );
  }

  // «Не на карте» (Q5): вложенные места этого места, у которых здесь нет пина.
  const pinnedPlaces = new Set(pins.filter((p) => p.target_type === "location").map((p) => p.target_id));
  const loose = (otherLocations ?? [])
    .filter((l) => l.parent_id === locationId && !l.archived_at && !pinnedPlaces.has(l.id))
    .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }))
    .map((l) => ({ key: String(l.id), label: l.name, drag: { type: "location" as const, id: l.id, title: l.name } }));

  return (
    <>
      <PinBoard
        words={WORDS}
        imageUrl={mapImageUrl}
        pins={resolved}
        pinsLoading={pinsLoading}
        maxZoom={mapMaxZoom ?? DEFAULT_MAX_ZOOM}
        startZoom={mapStartZoom ?? DEFAULT_START_ZOOM}
        gotoZoom={mapGotoZoom ?? DEFAULT_GOTO_ZOOM}
        labelsAlways={!!mapLabelsAlways}
        api={{ create: `/setting-locations/${locationId}/pins`, pin: (id) => `/setting-locations/pins/${id}` }}
        onChanged={changed}
        onUpload={uploadMap}
        uploading={uploading}
        dropBody={(item) => ({ target_type: item.type, target_id: item.id })}
        duplicateBody={(pin) => ({ target_type: (pin as MapPin).target_type, target_id: (pin as MapPin).target_id })}
        groups={PIN_GROUPS}
        renderPicked={renderPicked}
        loose={{ items: loose }}
        barActions={
          <button type="button" onClick={() => setSendOpen(true)}>
            <NavIcon name="arrowRight" /> В сессию
          </button>
        }
        replaceAt={1}
        menuItems={[
          { label: "Настройки карты…", onClick: openSettings },
          { label: "В мешок", onClick: () => addToBag({ type: "location_map", id: locationId, title: `Карта: ${locationName}` }) },
          ...(otherLocations && otherLocations.length > 0 ? [{ label: "Перенести карту…", onClick: () => setTransferOpen(true) }] : []),
          { label: "Убрать карту", danger: true, onClick: () => void removeMap() },
        ]}
        emptyPinsHint="Пинов пока нет: перетащите место или существо из поиска на карту."
        emptyImageHint="На карте потом ставятся пины мест и существ."
        brokenImageHint="Прежняя карта повреждена или с небезопасным адресом — загрузите заново."
        showToast={showToast}
      />
      {showSettings && (
        <Modal onClose={() => setShowSettings(false)}>
          <h3>Настройки карты</h3>
          <div className="stack">
            <label className="stack" style={{ gap: 4 }}>
              Максимальный зум (×)
              <input
                type="text"
                inputMode="decimal"
                value={settingsDraft.maxZoom}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, maxZoom: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Предел приближения колесом мыши и кнопками +/−.</span>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              Стартовый зум (при открытии страницы)
              <input
                type="text"
                inputMode="decimal"
                value={settingsDraft.startZoom}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, startZoom: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Какая степень приближения будет установлена при первом открытии карты.</span>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              Зум при переходе к пину
              <input
                type="text"
                inputMode="decimal"
                value={settingsDraft.gotoZoom}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, gotoZoom: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Приближение при щелчке по пину в списке справа.</span>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={settingsDraft.labelsAlways}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, labelsAlways: e.target.checked }))}
              />
              Всегда показывать подписи пинов
            </label>
            <div className="row">
              <button className="primary" onClick={saveSettings}>
                Сохранить
              </button>
              <button onClick={() => setShowSettings(false)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
      {transferOpen && otherLocations && (
        <Modal onClose={() => setTransferOpen(false)}>
          <h3>Перенести карту</h3>
          <div className="stack">
            <p className="muted">
              Карта и все её пины переедут в выбранную локацию. Если хотите оставить копию карты
              здесь тоже — отметьте флажок ниже.
            </p>
            <LocationCascadePicker locations={otherLocations} value={transferTarget} onChange={setTransferTarget} />
            {transferTarget === locationId && (
              <p className="muted">Нельзя перенести карту в ту же локацию — выберите другую.</p>
            )}
            <label className="row">
              <input
                type="checkbox"
                checked={transferKeepCopy}
                onChange={(e) => setTransferKeepCopy(e.target.checked)}
              />
              Оставить копию карты здесь
            </label>
            <div className="row">
              <button
                className="primary"
                disabled={transferTarget == null || transferTarget === locationId || transferring}
                onClick={transferMap}
              >
                {transferring ? "Переношу…" : "Перенести"}
              </button>
              <button onClick={() => setTransferOpen(false)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
      {sendOpen && (
        <SendMapToSessionModal locationId={locationId} settingId={settingId} onClose={() => setSendOpen(false)} />
      )}
      {confirmDialog}
      {toastNode}
    </>
  );
}

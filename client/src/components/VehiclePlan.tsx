import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { useConfirm, usePrompt } from "../hooks/useConfirm";
import { useMapToast } from "../hooks/useMapToast";
import { isSafeImageUrl } from "../utils/safeUrl";
import { PinBoard, type BoardPin } from "./PinBoard";
import type { CompendiumEntry } from "../types";

// Чертёж судна (гриллинг профилей 2026-10-02, Q9; тикет 05): ядро «картинка +
// пины», на нём посты экипажа и метки-подписи без сущности («трюм»,
// «баллиста»). Посты без пина — «Не на чертеже». Экипаж на постах — уже
// экземпляр судна в кампании, следующий шаг (спека, «Транспорт»).

interface PlanPin {
  id: number;
  post_id: number | null;
  post_name: string | null;
  text: string;
  x: number;
  y: number;
  color: string | null;
  size: number | null;
  border_color: string | null;
}

interface VehiclePlanData {
  blueprint_image_url: string | null;
  pins: PlanPin[];
}

interface ShipPin extends BoardPin {
  post_id: number | null;
}

const WORDS = { title: "Чертёж", acc: "чертёж", on: "на чертеже", to: "на чертёж", away: "Чертёж открыт на весь экран." };
const GROUPS = [
  { key: "vehicle_post", label: "Посты" },
  { key: "label", label: "Метки" },
];
// Метка — не сущность: точка тушью на бумажном кольце, подпись видна всегда.
const LABEL_DEFAULTS = { color: "#1f1a14", border: "#fffdf5" };

const planPath = (entryId: number) => `/vehicle-plans/${entryId}`;

export function VehiclePlan({ ship, posts }: { ship: CompendiumEntry; posts: CompendiumEntry[] }) {
  const path = planPath(ship.id);
  const plan = useResource<VehiclePlanData>(path).data;
  const afterWrite = useAfterWrite();
  const [uploading, setUploading] = useState(false);
  const [toastNode, showToast] = useMapToast();
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, prompt] = usePrompt();
  const changed = () => afterWrite([{ path }]);

  const pins: ShipPin[] = (plan?.pins ?? []).map((p) => ({
    id: p.id,
    kind: p.post_id != null ? "vehicle_post" : "label",
    post_id: p.post_id,
    x: p.x,
    y: p.y,
    color: p.color,
    size: p.size,
    border_color: p.border_color,
    label: p.post_name ?? p.text,
    typeLabel: p.post_id != null ? "Пост" : "Метка",
    alwaysLabel: p.post_id == null,
  }));
  const pinned = new Set(pins.map((p) => p.post_id).filter((id) => id != null));
  const postIds = new Set(posts.map((p) => p.id));

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await write.post(`${path}/image`, form, { timeoutMs: 120_000 });
      showToast("Чертёж загружен");
      changed();
    } catch (e) {
      showSaveError(`Чертёж не загрузился: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  async function removeImage() {
    const ok = await confirm({
      title: "Убрать чертёж?",
      message: `Убрать чертёж судна «${ship.name}» и все пины на нём (${pins.length})?`,
      confirmLabel: "Убрать",
      danger: true,
    });
    if (!ok) return;
    try {
      // Сервер кладёт картинку в _Archive — вернуть её можно со страницы «Архив».
      await write.del(`${path}/image`);
      changed();
    } catch (e) {
      showSaveError(`Чертёж не убрался: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function addLabel() {
    const text = (await prompt({ title: "Метка на чертеже", message: "Что здесь: трюм, баллиста, каюта капитана…", placeholder: "Трюм" }))?.trim();
    if (!text) return;
    try {
      await write.post(`${path}/pins`, { text, x: 50, y: 50 });
      showToast("Метка в центре чертежа — перетащите на место");
      changed();
    } catch (e) {
      showSaveError(`Метка не добавилась: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function renameLabel(pin: ShipPin) {
    const text = (await prompt({ title: "Метка на чертеже", message: "Новый текст метки", defaultValue: pin.label }))?.trim();
    if (!text || text === pin.label) return;
    try {
      await write.put(`/vehicle-plans/pins/${pin.id}`, { text });
      changed();
    } catch (e) {
      showSaveError(`Метка не переименовалась: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function renderPicked(pin: BoardPin) {
    const p = pin as ShipPin;
    const post = p.post_id != null ? posts.find((x) => x.id === p.post_id) : undefined;
    return (
      <div className="location-map-picked__plain">
        <span className="paper-label">{p.post_id != null ? "Пост экипажа" : "Метка"}</span>
        <strong>{p.label}</strong>
        {post ? (
          <Link className="comp-mini" to={`/compendium/${post.id}`}>
            Открыть ›
          </Link>
        ) : (
          p.post_id == null && (
            <button type="button" className="comp-mini" onClick={() => void renameLabel(p)}>
              Переименовать
            </button>
          )
        )}
      </div>
    );
  }

  const loose = posts
    .filter((p) => !pinned.has(p.id))
    .map((p) => ({ key: String(p.id), label: p.name || "Без названия", drag: { type: "vehicle_post" as const, id: p.id, title: p.name } }));

  return (
    <>
      <PinBoard
        words={WORDS}
        imageUrl={plan?.blueprint_image_url ?? null}
        pins={pins}
        maxZoom={6}
        startZoom={1}
        gotoZoom={3}
        labelsAlways={false}
        api={{ create: `${path}/pins`, pin: (id) => `/vehicle-plans/pins/${id}` }}
        onChanged={changed}
        onUpload={upload}
        uploading={uploading}
        dropBody={(item) =>
          (item.type === "vehicle_post" || item.type === "compendium_entry") && postIds.has(item.id)
            ? { post_id: item.id }
            : "На чертёж ставятся посты этого судна и метки"
        }
        duplicateBody={(pin) => {
          const p = pin as ShipPin;
          return p.post_id != null ? { post_id: p.post_id } : { text: p.label };
        }}
        groups={GROUPS}
        renderPicked={renderPicked}
        loose={{ items: loose }}
        barActions={
          <button type="button" onClick={() => void addLabel()}>
            + Метка
          </button>
        }
        menuItems={[{ label: "Убрать чертёж", danger: true, onClick: () => void removeImage() }]}
        emptyPinsHint="Пинов пока нет: перетащите пост из «Не на чертеже» или добавьте метку."
        emptyImageHint="На чертеже потом ставятся посты экипажа и метки: трюм, баллиста."
        brokenImageHint="Прежний чертёж повреждён или с небезопасным адресом — загрузите заново."
        showToast={showToast}
        defaultsFor={(kind) => (kind === "label" ? LABEL_DEFAULTS : null)}
      />
      {confirmDialog}
      {promptDialog}
      {toastNode}
    </>
  );
}

/**
 * Превью чертежа в «Досье» — на месте портрета (Q9): картинка с точками
 * пинов, щелчок ведёт на вкладку «Чертёж». Без чертежа — `fallback`
 * (портрет судна).
 */
export function VehiclePlanPreview({ entryId, onOpen, fallback }: { entryId: number; onOpen: () => void; fallback: ReactNode }) {
  const plan = useResource<VehiclePlanData>(planPath(entryId)).data;
  const url = plan?.blueprint_image_url;
  if (!plan || !url || !isSafeImageUrl(url)) return <>{fallback}</>;
  return (
    <button type="button" className="dossier__portrait vehicle-plan-preview" title="Открыть чертёж" onClick={onOpen}>
      <span className="vehicle-plan-preview__frame">
        <img src={url} alt="Чертёж судна" />
        {plan.pins.map((p) => (
          // инлайн-стиль намеренно — положение пина на картинке
          <span
            key={p.id}
            className={`vehicle-plan-preview__dot${p.post_id == null ? " is-label" : ""}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          />
        ))}
      </span>
      <span className="dossier__portrait-hint">Открыть чертёж</span>
    </button>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import type { Affect } from "../data/entities";
import { COMBAT_ROLES, CreatureCard, MAX_COMBAT_ROLES, type CreatureCardPayload } from "./CreatureCard";

// Вкладка «Карточка существа» — единственное место, где карточка правится.
// Правка по месту (в ноде полотна, в докстанции пульта) отклонена: это органы
// управления ровно там, где Мастер вожает (design_revision.md, шаг 4).

const SAVE_PATH: Record<string, (id: number) => string> = {
  being: (id) => `/setting-beings/${id}`,
  compendium_entry: (id) => `/systems/entries/${id}`,
};

// Одно и то же поле правится и здесь, и в «Досье» (у записи бестиария — в её
// собственном описании): это не копия, а тот же `description`.
const PROSE_HINT: Record<string, string> = {
  being: "То же поле, что «Описание» во вкладке «Досье».",
  compendium_entry: "То же поле, что описание записи.",
};

// Подсказка, а не автозаполнение: роль, проставленная приложением, — это
// метрика, придуманная за Мастера, и в карточке её быть не должно. Здесь она
// только предлагается, решение остаётся за ним.
function suggestRoles(data: CreatureCardPayload): string[] {
  if (!data.statblock) return [];
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(data.statblock.content || "{}") as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: string[] = [];
  const spellcasting = parsed.spellcasting as { enabled?: boolean } | undefined;
  if (spellcasting?.enabled) out.push("Заклинатель");
  const actions = Array.isArray(parsed.actions) ? (parsed.actions as { damage?: string; description?: string }[]) : [];
  const ranged = actions.some((a) =>
    `${a.damage ?? ""} ${a.description ?? ""}`.toLowerCase().includes("дистанц")
  );
  if (ranged) out.push("Дальний бой");
  else if (actions.length) out.push("Ближний бой");
  return out.slice(0, MAX_COMBAT_ROLES);
}

export function CreatureCardEditor({ type, id }: { type: "being" | "compendium_entry"; id: number }) {
  // Редактор — только у Мастера, поэтому читает мастерский маршрут напрямую,
  // без игроцкого запасного пути fetchCreatureCard.
  const card = useResource<CreatureCardPayload>(`/creature-card/${type}/${id}`);
  const data: CreatureCardPayload | null | undefined = card.data ?? (card.error ? null : undefined);
  const run = useAction();
  const [roles, setRoles] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [tactics, setTactics] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Поля заполняются из карточки, пока Мастер их не тронул. Пришедшее извне
  // (правка описания в «Досье», другое окно) не затирает набранное
  // (docs/adr/0001, п. 5): черновик сравнивается с тем, из чего был собран.
  const [seed, setSeed] = useState<CreatureCardPayload | null>(null);
  useEffect(() => {
    if (!card.data || card.data === seed) return;
    const untouched =
      !seed ||
      (description === seed.description &&
        tactics === seed.tactics.join("\n") &&
        secret === seed.secret &&
        roles.join("|") === seed.combat_roles.join("|"));
    setSeed(card.data);
    if (!untouched) return;
    setRoles(card.data.combat_roles);
    setDescription(card.data.description);
    setTactics(card.data.tactics.join("\n"));
    setSecret(card.data.secret);
  }, [card.data, seed, description, tactics, secret, roles]);

  function toggleRole(role: string) {
    setError("");
    if (roles.includes(role)) {
      setRoles(roles.filter((r) => r !== role));
      return;
    }
    if (roles.length >= MAX_COMBAT_ROLES) {
      setError("Ролей не больше двух — снимите одну. Существо «и танк, и контроль, и мобильный» — это существо без роли.");
      return;
    }
    setRoles([...roles, role]);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    const body = {
      description,
      combat_roles: roles,
      tactics: tactics
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
      secret,
    };
    const affects: Affect[] = [
      type === "being" ? { kind: "being", id } : { kind: "compendium_entry", id },
      { path: `/creature-card/${type}/${id}` },
    ];
    try {
      await run(() => write.put(SAVE_PATH[type](id), body), { affects });
    } finally {
      setSaving(false);
    }
  }

  if (data === undefined) return <span className="muted">Загрузка…</span>;
  if (data === null) return <span className="muted">Не найдено.</span>;

  const suggested = suggestRoles(data).filter((r) => !roles.includes(r));

  return (
    <div className="creature-card-editor">
      <div className="card stack">
        <span className="editable-card-field-label">Роль в бою</span>
        <div className="creature-card-editor__roles">
          {COMBAT_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              className={`creature-card__chip is-role${roles.includes(role) ? " is-picked" : ""}`}
              onClick={() => toggleRole(role)}
            >
              {role}
            </button>
          ))}
        </div>
        {error && <span className="muted">{error}</span>}
        {roles.length === 0 && suggested.length > 0 && (
          <span className="muted">
            Похоже на «{suggested.join("», «")}» —{" "}
            <button type="button" className="comp-mini" onClick={() => setRoles(suggested)}>
              поставить
            </button>
          </span>
        )}

        <span className="editable-card-field-label">Тактика</span>
        <span className="muted">Короткими строками, по одной на строку — 3–5 штук. За столом абзац не читается.</span>
        <textarea rows={5} value={tactics} onChange={(e) => setTactics(e.target.value)} />

        <span className="editable-card-field-label">Секрет</span>
        <textarea rows={3} value={secret} onChange={(e) => setSecret(e.target.value)} />

        <span className="editable-card-field-label">Описание</span>
        <span className="muted">
          {PROSE_HINT[type]}
          {type === "being" && data.inherited && !description.trim() && (
            <>
              {" "}
              Пока пусто, карточка показывает описание вида{" "}
              <Link to={`/compendium/${data.inherited.from_id}`}>«{data.inherited.from_name}»</Link>.{" "}
              <button
                type="button"
                className="comp-mini"
                onClick={() => setDescription(data.inherited!.description)}
              >
                Взять его себе и править
              </button>
            </>
          )}
        </span>
        <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />

        <div className="row">
          <button type="button" onClick={save} disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </div>

      <div className="creature-card-editor__preview">
        <span className="editable-card-field-label">Как выглядит</span>
        <CreatureCard data={data} variant="page" hideProfileButton />
      </div>
    </div>
  );
}

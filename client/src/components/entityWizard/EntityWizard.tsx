import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../Modal";
import { WIZARD_SPECS, WIZARD_TYPE_ORDER, draftForType } from "./specs";
import type { WizardContext, WizardDraft, WizardEntityType } from "./types";

// Пошаговое создание сущности сеттинга. Первый шаг общий для всех типов —
// название и тип (тип подставляется по месту, откуда визард открыли, но его
// можно сменить, не начиная заново). Дальше идут шаги конкретного типа.
//
// Создать можно с любого шага: остальные шаги — это поля, которые всё равно
// правятся в профиле, и заставлять проходить их целиком ради одного имени
// незачем.
export function EntityWizard({
  initialType,
  ctx,
  onClose,
  onCreated,
}: {
  initialType: WizardEntityType;
  ctx: WizardContext;
  onClose: () => void;
  // Вызывается после создания, когда визард закрывается на месте (кнопка
  // «Создать и вернуться») — списку на странице нужно перечитать себя.
  onCreated?: (id: number, type: WizardEntityType) => void;
}) {
  const navigate = useNavigate();
  const [type, setType] = useState<WizardEntityType>(initialType);
  const [draft, setDraft] = useState<WizardDraft>(() => draftForType(initialType, ctx));
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = WIZARD_SPECS[type];
  const steps = spec.steps(ctx);
  const totalSteps = steps.length + 1;
  const name = String(draft.name ?? "");
  const canCreate = name.trim().length > 0 && !saving;

  function patch(values: WizardDraft) {
    setDraft((prev) => ({ ...prev, ...values }));
  }

  function changeType(next: WizardEntityType) {
    setType(next);
    setDraft((prev) => draftForType(next, ctx, prev));
    // Шаги у типов разные, поэтому после смены возвращаемся на общий первый.
    setStepIndex(0);
  }

  async function create(then: "close" | "profile") {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const id = await spec.create(draft, ctx);
      if (then === "profile") {
        navigate(spec.profilePath(id, ctx));
      } else {
        onCreated?.(id, type);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="stack wizard">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>Создание: {spec.label.toLowerCase()}</h3>
          <span className="muted">
            Шаг {stepIndex + 1} из {totalSteps}
            {stepIndex > 0 && ` — ${steps[stepIndex - 1].title}`}
          </span>
        </div>

        {stepIndex === 0 ? (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Название</span>
              <input
                autoFocus
                value={name}
                placeholder={spec.namePlaceholder}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label className="stack editable-card-field">
              <span>Тип сущности</span>
              <select value={type} onChange={(e) => changeType(e.target.value as WizardEntityType)}>
                {WIZARD_TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {WIZARD_SPECS[t].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          steps[stepIndex - 1].render(draft, patch, ctx)
        )}

        {error && <span className="backup-info error">{error}</span>}

        {/* Навигация по шагам и создание — разными строками: вместе они не
            помещаются в одну даже на широком экране, а «Далее» вплотную к
            «Создать» слишком легко нажать вместо неё. */}
        <div className="row wizard-steps-nav">
          <button disabled={stepIndex === 0} onClick={() => setStepIndex((i) => i - 1)}>
            Назад
          </button>
          <button
            disabled={stepIndex >= totalSteps - 1}
            onClick={() => setStepIndex((i) => i + 1)}
            title={totalSteps === 1 ? "У этого типа пока только первый шаг" : undefined}
          >
            Далее
          </button>
        </div>
        <div className="row wizard-actions">
          <button className="primary" disabled={!canCreate} onClick={() => create("close")}>
            Создать и вернуться
          </button>
          <button disabled={!canCreate} onClick={() => create("profile")}>
            {spec.gotoLabel ?? `Создать и перейти в профиль ${spec.labelGenitive}`}
          </button>
          <button onClick={onClose}>Отмена</button>
        </div>
      </div>
    </Modal>
  );
}

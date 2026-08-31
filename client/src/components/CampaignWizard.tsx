import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "./Modal";
import {
  PAYMENT_TYPE_OPTIONS,
  CAMPAIGN_TYPE_OPTIONS,
  PAYMENT_FREQUENCY_OPTIONS,
  RATE_SPLIT_OPTIONS,
} from "../paymentTypes";
import type { Campaign, CampaignRole, CampaignType, PaymentFrequency, PaymentType, RateSplit, Setting, System } from "../types";

// Визард создания кампании — оболочка-копия EntityWizard/SettingWizard
// (design_revision.md §3: 5 шагов у сеттинга, обязательное поле одно,
//  кнопки создания активны с первого шага, без «Пропустить», оболочка
//  `Шаг N из M — <название>`, `Назад`/`Далее` отдельной строкой,
//  три кнопки действия отдельной строкой).
//
// Инвариант ревизии на визарде:
//  - радиусов нет, теней нет (кроме тени модалки, как у всех визардов),
//  - шапка визарда — не плашка-инверсия, а h3 + капс-подпись шага,
//  - моношрифт только под значения (ставка — число, поэтому моно),
//  - акцент один — primary «Создать»,
//  - плотность: внешние поля щедрые (модалка), внутренности компактные.
//
// Шаги по ТЗ:
//  1 — Название, Роль, Тип
//  2 — платная / условно-платная / бесплатная (только если Роль=Мастер)
//  3 — Система и Сеттинг
//  4 — периодичность, тип ставки, ставка, валюта (только если платная)
// Если роль=Игрок, шаг 2 не показывается; если не платная, шаг 4 не показывается.

interface Props {
  systems: System[];
  settings: Setting[];
  defaultSettingId?: number | string;
  onClose: () => void;
  onCreated?: () => void;
}

export function CampaignWizard({ systems, settings, defaultSettingId, onClose, onCreated }: Props) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState<CampaignRole>("gm");
  const [type, setType] = useState<CampaignType>("campaign");
  const [paymentType, setPaymentType] = useState<PaymentType>("free");
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>("per_session");
  const [rateSplit, setRateSplit] = useState<RateSplit>("per_person");
  const [sessionRate, setSessionRate] = useState("0");
  const [currency, setCurrency] = useState("RUB");
  const [systemId, setSystemId] = useState("");
  const [settingId, setSettingId] = useState(defaultSettingId ? String(defaultSettingId) : "");

  // Динамический список шагов — §1.11: блока, которому нечего показать, нет.
  const steps = (() => {
    const all = [
      { key: "basics", title: "Основы" },
      ...(role === "gm" ? [{ key: "payment", title: "Оплата" }] : []),
      { key: "world", title: "Система и сеттинг" },
      ...(role === "gm" && paymentType === "paid" ? [{ key: "finance", title: "Условия оплаты" }] : []),
    ];
    return all;
  })();

  const totalSteps = steps.length;

  // Если смена роли/оплаты убрала текущий шаг — откатываем индекс.
  useEffect(() => {
    if (stepIndex >= totalSteps) setStepIndex(totalSteps - 1);
  }, [totalSteps, stepIndex]);

  const canCreate = name.trim().length > 0 && !saving && name.trim().length <= 80;

  async function create(then: "close" | "campaign") {
    if (!canCreate) return;
    const trimmed = name.trim();
    if (trimmed.length > 80) {
      setError("Название не длиннее 80 символов");
      return;
    }
    if (currency.trim().length > 16) {
      setError("Валюта не длиннее 16 символов");
      return;
    }
    const rateNum = Number(sessionRate);
    if (role === "gm" && paymentType === "paid") {
      if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 999999) {
        setError("Ставка — число от 0 до 999 999");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<Campaign>("/campaigns", {
        name: trimmed,
        role,
        type,
        system_id: systemId ? Number(systemId) : null,
        setting_id: settingId ? Number(settingId) : null,
        payment_type: role === "player" ? "free" : paymentType,
        payment_frequency: paymentFrequency,
        rate_split: rateSplit,
        session_rate: role === "gm" && paymentType === "paid" ? Math.max(0, Math.min(999999, Math.trunc(rateNum))) : 0,
        currency: currency.trim() || "RUB",
      });
      onCreated?.();
      if (then === "campaign") navigate(`/campaigns/${created.id}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const current = steps[stepIndex];

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="stack wizard">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>Новая кампания</h3>
          <span className="muted">
            Шаг {stepIndex + 1} из {totalSteps} — {current?.title}
          </span>
        </div>

        {current?.key === "basics" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Название</span>
              <input
                autoFocus
                value={name}
                maxLength={80}
                placeholder="Как называется кампания"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="stack editable-card-field">
              <span>Моя роль</span>
              <select value={role} onChange={(e) => setRole(e.target.value as CampaignRole)}>
                <option value="gm">Я Мастер</option>
                <option value="player">Я Игрок</option>
              </select>
            </label>
            <label className="stack editable-card-field">
              <span>Тип</span>
              <select value={type} onChange={(e) => setType(e.target.value as CampaignType)}>
                {CAMPAIGN_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {current?.key === "payment" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Оплата</span>
              <select value={paymentType} onChange={(e) => setPaymentType(e.target.value as PaymentType)}>
                {PAYMENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted image-hint">
              Бесплатная — без ставки, условно-платная — ставка по договорённости, платная — ставка обязательна.
            </span>
          </div>
        )}

        {current?.key === "world" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Система</span>
              <select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
                <option value="">—</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack editable-card-field">
              <span>Сеттинг</span>
              <select value={settingId} onChange={(e) => setSettingId(e.target.value)}>
                <option value="">—</option>
                {settings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {current?.key === "finance" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Периодичность</span>
              <select value={paymentFrequency} onChange={(e) => setPaymentFrequency(e.target.value as PaymentFrequency)}>
                {PAYMENT_FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack editable-card-field">
              <span>Тип ставки</span>
              <select value={rateSplit} onChange={(e) => setRateSplit(e.target.value as RateSplit)}>
                {RATE_SPLIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack editable-card-field">
              <span>
                Сумма {rateSplit === "per_person" ? "с человека" : "со стола"}{" "}
                {paymentFrequency === "per_month" ? "в месяц" : "за сессию"}
              </span>
              <input
                type="number"
                min={0}
                max={999999}
                step={1}
                value={sessionRate}
                onChange={(e) => setSessionRate(e.target.value)}
              />
            </label>
            <label className="stack editable-card-field">
              <span>Валюта</span>
              <input value={currency} maxLength={16} placeholder="RUB" onChange={(e) => setCurrency(e.target.value)} />
            </label>
          </div>
        )}

        {error && <span className="backup-info error">{error}</span>}

        <div className="row wizard-steps-nav">
          <button disabled={stepIndex === 0} onClick={() => setStepIndex((i) => i - 1)}>
            Назад
          </button>
          <button disabled={stepIndex >= totalSteps - 1} onClick={() => setStepIndex((i) => i + 1)}>
            Далее
          </button>
        </div>
        <div className="row wizard-actions">
          <button className="primary" disabled={!canCreate} onClick={() => create("close")}>
            {saving ? "Создаю…" : "Создать и вернуться"}
          </button>
          <button disabled={!canCreate} onClick={() => create("campaign")}>
            Создать и перейти в кампанию
          </button>
          <button onClick={onClose} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}

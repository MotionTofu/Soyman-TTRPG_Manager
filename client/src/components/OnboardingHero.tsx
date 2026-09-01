import { useState } from "react";
import { api } from "../api/client";
import { NavIcon } from "./NavIcons";
import { CampaignWizard } from "./CampaignWizard";
import { PlayerCreationModal } from "./PlayerCreationModal";
import { SystemOnboardingModal } from "./SystemOnboardingModal";
import { SettingOnboardingModal } from "./SettingOnboardingModal";
import { Modal } from "./Modal";
import type { Campaign, Setting, System, Player } from "../types";

// Onboarding Hero — единый герой пустой Главной (audit P1 D-02/D-03).
// Показывает 5 шагов до первой сессии, соблюдая инварианты design_revision.md:
// §1.3 1px повсюду, §1.4 шапка-инверсия, §1.5 четыре голоса, §1.7 форма vs цвет,
// §1.11 один главный блок вместо двух EmptyState.
interface Step {
  num: number;
  key: string;
  title: string;
  icon: string;
  needsSystem?: boolean;
  needsSetting?: boolean;
  needsCampaign?: boolean;
  hint: string;
  blockedHint: string;
}

const STEPS: Step[] = [
  { num: 1, key: "system", title: "Система", icon: "systems", hint: "Правила мира — D&D, LitM…", blockedHint: "" },
  { num: 2, key: "setting", title: "Сеттинг", icon: "settings", needsSystem: true, hint: "Где играем — мир, карта", blockedHint: "Сначала заведи систему" },
  { num: 3, key: "campaign", title: "Кампания", icon: "campaigns", needsSystem: true, needsSetting: true, hint: "История и игроки", blockedHint: "Нужны система и сеттинг" },
  { num: 4, key: "players", title: "Игроки", icon: "players", needsCampaign: true, hint: "Кто за столом", blockedHint: "Сначала заведи кампанию" },
  { num: 5, key: "session", title: "Сессия", icon: "calendar", needsCampaign: true, hint: "Первая игра", blockedHint: "Нужна кампания" },
];

interface Props {
  systems: System[];
  settings: Setting[];
  campaigns: Campaign[];
  players?: Player[];
  onRefresh: () => void;
}

export function OnboardingHero({ systems, settings, campaigns, players = [], onRefresh }: Props) {
  const [showSystemModal, setShowSystemModal] = useState(false);
  const [showSettingModal, setShowSettingModal] = useState(false);
  const [showCampaignWizard, setShowCampaignWizard] = useState(false);
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sessionTime, setSessionTime] = useState("");
  const [sessionCreating, setSessionCreating] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const hasSystem = systems.length > 0;
  const hasSetting = settings.length > 0;
  const hasCampaign = campaigns.length > 0;
  const hasPlayer = players.length > 0;

  function isCompleted(step: Step): boolean {
    switch (step.key) {
      case "system": return hasSystem;
      case "setting": return hasSetting;
      case "campaign": return hasCampaign;
      case "players": return hasPlayer;
      case "session": return false;
      default: return false;
    }
  }

  function isClickable(step: Step): boolean {
    if (isCompleted(step)) return false;
    if (step.needsSystem && !hasSystem) return false;
    if (step.needsSetting && !hasSetting) return false;
    if (step.needsCampaign && !hasCampaign) return false;
    return true;
  }

  // Next step hint for progress encouragement (P2 U-07)
  const nextStep = STEPS.find((s) => !isCompleted(s) && isClickable(s));
  const completedCount = STEPS.filter((s) => isCompleted(s)).length;

  function handleClick(step: Step) {
    if (!isClickable(step)) return;
    switch (step.key) {
      case "system": setShowSystemModal(true); break;
      case "setting": setShowSettingModal(true); break;
      case "campaign": setShowCampaignWizard(true); break;
      case "players": setShowPlayerModal(true); break;
      case "session":
        if (hasCampaign) {
          setSessionDate(new Date().toISOString().slice(0, 10));
          setSessionTime("");
          setSessionError(null);
          setShowSessionModal(true);
        }
        break;
    }
  }

  async function createSession() {
    if (!hasCampaign || sessionCreating) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      setSessionError("Неверная дата");
      return;
    }
    setSessionCreating(true);
    setSessionError(null);
    try {
      await api.post("/sessions", {
        campaign_id: campaigns[0].id,
        date: sessionDate,
        start_time: sessionTime || null,
      });
      setShowSessionModal(false);
      onRefresh();
    } catch (e) {
      setSessionError(String(e instanceof Error ? e.message : e));
    } finally {
      setSessionCreating(false);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* §1.4 шапка-инверсия */}
      <div style={{ background: "var(--surface)", color: "var(--on-surface)", padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h3)", lineHeight: 0.96, textTransform: "uppercase", letterSpacing: "-0.01em", color: "var(--on-surface)" }}>Твоя первая легенда</span>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--on-surface-muted)" }}>Пять шагов до первой сессии — идём по порядку</span>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, background: "var(--paper-2)", backgroundImage: "var(--card-body-texture)" }}>
        {/* Прогресс §1.5 Data Mono + Label */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink)", background: "var(--paper)", border: "1px solid var(--line)", padding: "2px 6px" }}>
            {completedCount} / {STEPS.length} готово
          </span>
          <span style={{ flex: "1 1 auto", height: 6, background: "var(--paper)", border: "1px solid var(--line)", position: "relative", overflow: "hidden", maxWidth: 220 }}>
            <span style={{ position: "absolute", inset: 0, width: `${(completedCount / STEPS.length) * 100}%`, background: "var(--surface)", transition: "width 200ms" }} />
          </span>
          {nextStep && (
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink)", background: "var(--paper)", border: "1px solid var(--ink)", padding: "3px 8px" }}>
              Далее: {nextStep.title}
            </span>
          )}
        </div>

        <div className="onboarding-steps" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STEPS.map((step) => {
            const completed = isCompleted(step);
            const clickable = isClickable(step);
            const blocked = !completed && !clickable;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => handleClick(step)}
                disabled={blocked}
                title={blocked ? step.blockedHint : clickable ? step.hint : "Готово"}
                style={{
                  flex: "1 1 120px",
                  minWidth: 110,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 8px",
                  background: completed ? "var(--surface)" : clickable ? "var(--paper)" : "var(--paper-2)",
                  color: completed ? "var(--on-surface)" : "var(--ink)",
                  border: `1px solid ${clickable ? "var(--accent)" : completed ? "var(--surface)" : "var(--line)"}`,
                  opacity: blocked ? 0.55 : 1,
                  cursor: blocked ? "not-allowed" : "pointer",
                }}
              >
                {/* §1.7 форма vs цвет: завершён — залитый квадрат, активен — контур accent, заблокирован — пустой muted */}
                <span
                  aria-hidden="true"
                  style={{
                    width: 32,
                    height: 32,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${completed ? "var(--on-surface)" : clickable ? "var(--accent)" : "var(--line)"}`,
                    background: completed ? "var(--on-surface)" : clickable ? "var(--accent-soft)" : "transparent",
                    color: completed ? "var(--surface)" : clickable ? "var(--ink)" : "var(--muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  {completed ? <NavIcon name="check" /> : <span style={{ fontFamily: "var(--font-mono)" }}>{step.num}</span>}
                </span>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1.1, textAlign: "center" }}>{step.title}</span>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: completed ? "var(--on-surface-muted)" : "var(--muted)", lineHeight: 1.2, textAlign: "center" }}>{completed ? "Готово" : blocked ? step.blockedHint : step.hint}</span>
              </button>
            );
          })}
        </div>

        {/* Подсказка следующего действия — не даёт тыкать в серое молча (U-04) */}
        {nextStep && (
          <div className="card" style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "8px 10px", fontSize: "var(--fs-meta)", lineHeight: 1.35 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Подсказка</span>
            <span style={{ marginLeft: 8 }}>Нажми «{nextStep.title}» — {nextStep.hint.toLowerCase()}</span>
          </div>
        )}
      </div>

      {showSystemModal && (
        <SystemOnboardingModal
          onClose={() => setShowSystemModal(false)}
          onCreated={onRefresh}
        />
      )}

      {showSettingModal && (
        <SettingOnboardingModal
          onClose={() => setShowSettingModal(false)}
          onRefresh={onRefresh}
        />
      )}

      {showCampaignWizard && (
        <CampaignWizard
          systems={systems}
          settings={settings}
          onClose={() => setShowCampaignWizard(false)}
          onCreated={() => {
            setShowCampaignWizard(false);
            onRefresh();
          }}
        />
      )}

      {showPlayerModal && (
        <PlayerCreationModal
          onClose={() => setShowPlayerModal(false)}
          onCreated={() => {
            setShowPlayerModal(false);
            onRefresh();
          }}
        />
      )}

      {showSessionModal && (
        <Modal onClose={() => setShowSessionModal(false)} closeOnBackdropClick={false}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Новая сессия</h3>
            <p className="muted" style={{ margin: 0 }}>
              Кампания: {campaigns[0]?.name}
            </p>
            <label>
              Дата
              <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
            </label>
            <label>
              Время начала (необязательно)
              <input type="time" value={sessionTime} onChange={(e) => setSessionTime(e.target.value)} />
            </label>
            {sessionError && <span className="backup-info error">{sessionError}</span>}
            <div className="row">
              <button className="primary" onClick={createSession} disabled={sessionCreating}>
                {sessionCreating ? "Создаю…" : "Создать"}
              </button>
              <button onClick={() => setShowSessionModal(false)} disabled={sessionCreating}>
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

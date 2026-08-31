import { useState } from "react";
import { api } from "../api/client";
import { NavIcon } from "./NavIcons";
import { CampaignWizard } from "./CampaignWizard";
import { PlayerCreationModal } from "./PlayerCreationModal";
import { SystemOnboardingModal } from "./SystemOnboardingModal";
import { SettingOnboardingModal } from "./SettingOnboardingModal";
import { Modal } from "./Modal";
import type { Campaign, Setting, System, Player } from "../types";

// Onboarding Hero — показывается на главной, пока не создана первая сессия.
// Пять горизонтальных шагов: Система → Сеттинг → Кампания → Игроки → Сессия.
// Каждый шаг активен, если его ещё не выполнил. Неактивные шаги — приглушены
// с галочкой. Клик по активному шагу открывает соответствующий визард/модалку.

interface Step {
  num: number;
  key: string;
  title: string;
  icon: string;
  needsSystem?: boolean;
  needsSetting?: boolean;
  needsCampaign?: boolean;
}

const STEPS: Step[] = [
  { num: 1, key: "system", title: "Система", icon: "systems" },
  { num: 2, key: "setting", title: "Сеттинг", icon: "settings", needsSystem: true },
  { num: 3, key: "campaign", title: "Кампания", icon: "campaigns", needsSystem: true, needsSetting: true },
  { num: 4, key: "players", title: "Игроки", icon: "players", needsCampaign: true },
  { num: 5, key: "session", title: "Сессия", icon: "calendar", needsCampaign: true },
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

  // Определяем, какие шаги выполнены
  const hasSystem = systems.length > 0;
  const hasSetting = settings.length > 0;
  const hasCampaign = campaigns.length > 0;
  const hasPlayer = players.length > 0;
  // Сессии не проверяем — hero исчезает, как только появляется первая сессия

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

  function handleClick(step: Step) {
    if (!isClickable(step)) return;

    switch (step.key) {
      case "system":
        setShowSystemModal(true);
        break;
      case "setting":
        setShowSettingModal(true);
        break;
      case "campaign":
        setShowCampaignWizard(true);
        break;
      case "players":
        setShowPlayerModal(true);
        break;
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
    <div className="card home-hero home-hero-onboarding">
      <div className="onboarding-header">
        <h2 className="onboarding-title">Начните с чего-то</h2>
        <p className="onboarding-hint">Пять шагов до первой сессии</p>
      </div>
      <div className="onboarding-steps">
        {STEPS.map((step) => {
          const completed = isCompleted(step);
          const clickable = isClickable(step);
          return (
            <button
              key={step.key}
              type="button"
              className={`onboarding-step ${completed ? "onboarding-step-done" : ""} ${clickable ? "onboarding-step-active" : ""}`}
              onClick={() => handleClick(step)}
              disabled={!clickable && !completed}
            >
              <div className="onboarding-step-num">
                {completed ? (
                  <NavIcon name="check" />
                ) : (
                  <span>{step.num}</span>
                )}
              </div>
              <div className="onboarding-step-title">{step.title}</div>
            </button>
          );
        })}
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

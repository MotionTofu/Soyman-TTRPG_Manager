import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { NavIcon } from "./NavIcons";
import { CampaignWizard } from "./CampaignWizard";
import { SettingWizard } from "./SettingWizard";
import { PlayerCreationModal } from "./PlayerCreationModal";
import type { Campaign, Setting, System } from "../types";

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
  onRefresh: () => void;
}

export function OnboardingHero({ systems, settings, campaigns, onRefresh }: Props) {
  const navigate = useNavigate();
  const [showSettingWizard, setShowSettingWizard] = useState(false);
  const [showCampaignWizard, setShowCampaignWizard] = useState(false);
  const [showPlayerModal, setShowPlayerModal] = useState(false);

  // Определяем, какие шаги выполнены
  const hasSystem = systems.length > 0;
  const hasSetting = settings.length > 0;
  const hasCampaign = campaigns.length > 0;
  // Сессии не проверяем — hero исчезает, как только появляется первая сессия

  function isCompleted(step: Step): boolean {
    switch (step.key) {
      case "system": return hasSystem;
      case "setting": return hasSetting;
      case "campaign": return hasCampaign;
      case "players": return false; // всегда можно добавить ещё
      case "session": return false; // всегда можно создать ещё
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
        navigate("/systems");
        break;
      case "setting":
        setShowSettingWizard(true);
        break;
      case "campaign":
        setShowCampaignWizard(true);
        break;
      case "players":
        setShowPlayerModal(true);
        break;
      case "session":
        // Пока нет кампании — ничего
        if (hasCampaign) {
          navigate(`/campaigns/${campaigns[0].id}`);
        }
        break;
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

      {showSettingWizard && (
        <SettingWizard
          onClose={() => {
            setShowSettingWizard(false);
            onRefresh();
          }}
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
          }}
        />
      )}
    </div>
  );
}

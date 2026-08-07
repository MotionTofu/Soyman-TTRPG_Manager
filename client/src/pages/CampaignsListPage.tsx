import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { SectionHeading } from "../components/SectionHeading";
import {
  PAYMENT_TYPE_OPTIONS,
  PAYMENT_TYPE_LABELS,
  CAMPAIGN_TYPE_OPTIONS,
  PAYMENT_FREQUENCY_OPTIONS,
  RATE_SPLIT_OPTIONS,
} from "../paymentTypes";
import { cardThumbnailProps, loadThumbnailStyles } from "../thumbnailStyles";
import { loadHideFinance } from "../financePrivacy";
import { loadListViewMode, saveListViewMode, type ListViewMode } from "../listViewMode";
import { ViewModeToggle } from "../components/ViewModeToggle";
import type { Campaign, CampaignRole, CampaignType, PaymentFrequency, PaymentType, RateSplit, Setting, System } from "../types";

export function CampaignsListPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [systems, setSystems] = useState<System[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [creating, setCreating] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"all" | CampaignRole>("all");
  const [viewMode, setViewMode] = useState<ListViewMode>(() => loadListViewMode("campaigns"));
  const thumbnailStyles = loadThumbnailStyles();

  function changeViewMode(m: ListViewMode) {
    setViewMode(m);
    saveListViewMode("campaigns", m);
  }
  const [form, setForm] = useState({
    name: "",
    role: "gm" as CampaignRole,
    type: "campaign" as CampaignType,
    system_id: "",
    setting_id: "",
    payment_type: "free" as PaymentType,
    payment_frequency: "per_session" as PaymentFrequency,
    rate_split: "per_person" as RateSplit,
    session_rate: "0",
    currency: "RUB",
  });

  function refresh() {
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
  }

  useEffect(() => {
    refresh();
    api.get<System[]>("/systems").then(setSystems);
    api.get<Setting[]>("/settings").then(setSettings);
  }, []);

  async function createCampaign() {
    if (!form.name.trim()) return;
    await api.post("/campaigns", {
      name: form.name,
      role: form.role,
      type: form.type,
      system_id: form.system_id ? Number(form.system_id) : null,
      setting_id: form.setting_id ? Number(form.setting_id) : null,
      payment_type: form.payment_type,
      payment_frequency: form.payment_frequency,
      rate_split: form.rate_split,
      session_rate: Number(form.session_rate) || 0,
      currency: form.currency,
    });
    setCreating(false);
    setForm({
      name: "",
      role: "gm",
      type: "campaign",
      system_id: "",
      setting_id: "",
      payment_type: "free",
      payment_frequency: "per_session",
      rate_split: "per_person",
      session_rate: "0",
      currency: "RUB",
    });
    refresh();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SectionHeading>Кампании</SectionHeading>
        <div className="row">
          <ViewModeToggle mode={viewMode} onChange={changeViewMode} />
          <button className="primary" onClick={() => setCreating(true)}>
            + Новая кампания
          </button>
        </div>
      </div>

      <div className="tabs">
        {([
          { value: "all", label: "Все" },
          { value: "gm", label: "Я мастер" },
          { value: "player", label: "Я игрок" },
        ] as const).map((f) => (
          <button
            key={f.value}
            className={roleFilter === f.value ? "active" : ""}
            onClick={() => setRoleFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={`grid-cards mode-${viewMode}`}>
        {campaigns
          .filter((c) => roleFilter === "all" || c.role === roleFilter)
          .map((c) => {
            const thumb = cardThumbnailProps(thumbnailStyles.campaigns, c.thumbnail_image_url ?? c.background_image_url);
            return (
          <Link key={c.id} to={`/campaigns/${c.id}`} className={`card ${thumb.className}`} style={thumb.style}>
            {thumb.showBanner && (
              thumb.bannerUrl ? (
                <img src={thumb.bannerUrl} alt="" className="campaign-thumb" />
              ) : (
                <div className="campaign-card-band zine-grain zine-torn-bottom" />
              )
            )}
            <h3>{c.name}</h3>
            <div className="muted">{c.system_name ?? "система не выбрана"}</div>
            <div className="muted">{c.setting_name ?? "без сеттинга"}</div>
            <div className="row">
              <span className="badge tag">{c.status}</span>
              {c.role === "player" ? (
                <span className="badge role-player-badge">Я игрок</span>
              ) : (
                !loadHideFinance() && (
                  <span
                    className={`badge ${c.payment_type === "paid" ? "held" : c.payment_type === "negotiable" ? "rescheduled" : "planned"}`}
                  >
                    {PAYMENT_TYPE_LABELS[c.payment_type]}
                  </span>
                )
              )}
            </div>
            <div className="muted">
              Игроков: {c.player_count ?? 0} · Сессий состоялось: {c.held_sessions_count ?? 0}
            </div>
            {c.next_planned_date && (
              <div className="muted">Ближайшая сессия: {c.next_planned_date}</div>
            )}
          </Link>
            );
          })}
        {campaigns.length === 0 && <p className="muted">Пока нет кампаний.</p>}
      </div>

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <h2>Новая кампания</h2>
          <div className="stack">
            <label>
              Название
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Моя роль
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as CampaignRole })}
              >
                <option value="gm">Я Мастер</option>
                <option value="player">Я Игрок</option>
              </select>
            </label>
            <label>
              Тип
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as CampaignType })}
              >
                {CAMPAIGN_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Система
              <select
                value={form.system_id}
                onChange={(e) => setForm({ ...form, system_id: e.target.value })}
              >
                <option value="">—</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Сеттинг
              <select
                value={form.setting_id}
                onChange={(e) => setForm({ ...form, setting_id: e.target.value })}
              >
                <option value="">—</option>
                {settings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {form.role === "gm" && (
              <>
                <label>
                  Оплата
                  <select
                    value={form.payment_type}
                    onChange={(e) =>
                      setForm({ ...form, payment_type: e.target.value as PaymentType })
                    }
                  >
                    {PAYMENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.payment_type === "paid" && (
                  <>
                    <label>
                      Периодичность
                      <select
                        value={form.payment_frequency}
                        onChange={(e) =>
                          setForm({ ...form, payment_frequency: e.target.value as PaymentFrequency })
                        }
                      >
                        {PAYMENT_FREQUENCY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Тип ставки
                      <select
                        value={form.rate_split}
                        onChange={(e) => setForm({ ...form, rate_split: e.target.value as RateSplit })}
                      >
                        {RATE_SPLIT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Ставка{" "}
                      {form.payment_frequency === "per_month" ? "в месяц" : "за сессию"}
                      {form.rate_split === "per_person" ? " (с человека)" : " (со стола)"}
                      <input
                        type="number"
                        value={form.session_rate}
                        onChange={(e) => setForm({ ...form, session_rate: e.target.value })}
                      />
                    </label>
                  </>
                )}
                <label>
                  Валюта
                  <input
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  />
                </label>
              </>
            )}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => setCreating(false)}>Отмена</button>
              <button className="primary" onClick={createCampaign}>
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

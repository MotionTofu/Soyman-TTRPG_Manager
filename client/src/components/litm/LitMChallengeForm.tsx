import type { LitMChallengeData } from "../../types";
import { PipTrack } from "./PipTrack";
import { LitmChallengeProfile } from "./LitmChallengeProfile";
import { Rating, Roles } from "./LitmBook";
import { profileFromContent, ROLE_ORDER } from "./litmChallenge";
import { MIGHT_NAMES } from "./litmBookText";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";

export function emptyChallenge(): LitMChallengeData {
  return {
    title: "",
    role: "",
    mightLevel: "origin",
    might: 0,
    tagsAndStatuses: "",
    limits: "",
    threatsConsequences: "",
    specialFeatures: "",
  };
}

export function LitMChallengeEdit({
  value,
  onChange,
}: {
  value: LitMChallengeData;
  onChange: (v: LitMChallengeData) => void;
}) {
  const structured = Array.isArray(value.roles);
  const legacyRoles = value.role ? [value.role] : [];
  const selectedRoles = structured ? value.roles?.length ? value.roles : legacyRoles : legacyRoles;
  const roles = [...new Set([...ROLE_ORDER, ...selectedRoles])];
  const toggleRole = (role: string) => {
    const next = selectedRoles.includes(role) ? selectedRoles.filter((r) => r !== role) : [...selectedRoles, role];
    onChange({ ...value, roles: next, role: next.join(", ") });
  };

  return (
    <div className="stack">
      <label>
        Название угрозы
        <input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </label>
      {structured ? (
        <fieldset className="lb-ed__roles">
          <legend>Роли</legend>
          {roles.map((role) => (
            <label key={role} className="lb-ed__chip">
              <input type="checkbox" checked={selectedRoles.includes(role)} onChange={() => toggleRole(role)} />
              {role}
            </label>
          ))}
        </fieldset>
      ) : (
        <label>
          Роль (Role)
          <select value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value })}>
            <option value="">— выберите роль —</option>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
      )}
      <label className="row">
        Ступень могущества (Might Level)
        <select value={value.mightLevel} onChange={(e) => onChange({ ...value, mightLevel: e.target.value as "origin" | "adventure" | "greatness" | "variable" })}>
          {Object.entries(MIGHT_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="row">
        Мощь (Might)
        <PipTrack value={value.might} max={5} onChange={(n) => onChange({ ...value, might: n })} label="Мощь" />
      </label>
      <label>
        Теги и статусы (по одному на строку)
        <MentionTextarea
          value={value.tagsAndStatuses}
          onChange={(v) => onChange({ ...value, tagsAndStatuses: v })}
          rows={3}
        />
      </label>
      <label>
        Пределы (Limits)
        <MentionTextarea value={value.limits} onChange={(v) => onChange({ ...value, limits: v })} rows={3} />
      </label>
      <label>
        Угрозы и последствия (Threats & Consequences)
        <MentionTextarea
          value={value.threatsConsequences}
          onChange={(v) => onChange({ ...value, threatsConsequences: v })}
          rows={6}
        />
      </label>
      <label>
        Особые черты (Special Features)
        <MentionTextarea
          value={value.specialFeatures}
          onChange={(v) => onChange({ ...value, specialFeatures: v })}
          rows={4}
        />
      </label>
    </div>
  );
}

export function LitMChallengeView({
  value,
}: {
  value: LitMChallengeData;
}) {
  // Вызов, размеченный по книге (установщик пачки «Вызовы»), — профилем доски
  // Litm-Challenges; свои вызовы Мастера в прежнем текстовом виде — как были.
  const marked = value as LitMChallengeData & Record<string, unknown>;
  if (Array.isArray(marked.threatList)) {
    const profile = profileFromContent({ name: value.title, name_original: String(marked.titleEn ?? ""), description: "", data: {} }, marked);
    return (
      <div className="litm-book litm-book--inline">
        <div className="lb-file">
          <span className="lb-kind">Профиль вызова</span>
          {profile.location && <span>{profile.location}</span>}
          {profile.roles.length > 0 && <Roles roles={profile.roles} />}
          {profile.rating > 0 && <span>рейтинг <Rating value={profile.rating} /></span>}
        </div>
        <LitmChallengeProfile profile={profile} />
        {profile.page && <div className="lb-src">Legend in the Mist · том II · с. {profile.page}</div>}
      </div>
    );
  }
  return (
    <div className="stack sb-scope">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{value.title || "Без названия"}</strong>
        {value.role && <span className="badge planned">{value.role}</span>}
      </div>
      <div className="row">
        <span className="muted">Мощь:</span> <PipTrack value={value.might} max={5} />
      </div>
      {value.tagsAndStatuses && (
        <div>
          <strong>Теги и статусы</strong>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={value.tagsAndStatuses} />
          </div>
        </div>
      )}
      {value.limits && (
        <div>
          <strong>Пределы</strong>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={value.limits} />
          </div>
        </div>
      )}
      {value.threatsConsequences && (
        <div>
          <strong>Угрозы и последствия</strong>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={value.threatsConsequences} />
          </div>
        </div>
      )}
      {value.specialFeatures && (
        <div>
          <strong>Особые черты</strong>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={value.specialFeatures} />
          </div>
        </div>
      )}
    </div>
  );
}

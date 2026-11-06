import { Fragment } from "react";
import { MentionText } from "../mentions/MentionText";
import { Consequence, LitmRich, MightMark } from "./LitmBook";
import { mightOf, type LitmChallengeProfileData, type LitmChallengeTag } from "./litmChallenge";

/** Профиль вызова (доска Litm-Challenges): угрозы → последствия и особенности
 *  слева; пределы, теги и статусы, Могущество справа. На телефоне правая колонка
 *  встаёт над угрозами. */
/** `hideLimits` — гнездо пульта «Вызовы»: пределы там живые, своим блоком над
 *  профилем, второй раз их не показывать. */
export function LitmChallengeProfile({ profile, hideLimits }: { profile: LitmChallengeProfileData; hideLimits?: boolean }) {
  const p = profile;
  if (p.legacy) return <LegacyProfile profile={p} />;
  return (
    <>
      {p.description && <p className="lb-lead"><LitmRich text={p.description} /></p>}
      <div className="lb-prof">
        <div className="lb-prof__main">
          {p.threatList.length > 0 && <div className="lb-lbl">Угрозы и последствия<small>Threats &amp; Consequences</small></div>}
          {p.threatList.map((t, i) => (
            <div key={i} className="lb-thr">
              <h4>{t.name && <b>{t.name}</b>}<span><LitmRich text={t.lead} /></span></h4>
              <ul>
                {t.consequences.map((c, k) => <li key={k}><Consequence text={c} /></li>)}
              </ul>
            </div>
          ))}
          {p.specialList.length > 0 && (
            <>
              <div className="lb-lbl lb-gap">Особенности<small>Special Features</small></div>
              {p.specialList.map((s, i) => (
                <div key={i} className="lb-spc"><b>{s.name}</b><p><LitmRich text={s.text} /></p></div>
              ))}
            </>
          )}
        </div>
        <aside className="lb-prof__side">
          {!hideLimits && p.limitList.length > 0 && (
            <div>
              <div className="lb-lbl">Пределы<small>Limits</small></div>
              {p.limitList.map((l, i) => (
                <div key={i} className="lb-lim">
                  <b>{l.name}{l.nameEn && <small>{l.nameEn.toLocaleLowerCase("en")}</small>}</b>
                  <i aria-hidden="true">{/^\d+$/.test(l.max) ? Array.from({ length: Number(l.max) }, (_, k) => <u key={k} />) : null}</i>
                  <span className="lb-lim__num">{l.max}{l.arrow && <sup title="Когда предел достигнут">↻</sup>}</span>
                  {l.note && <p>↻ <LitmRich text={l.note} /></p>}
                </div>
              ))}
            </div>
          )}
          {p.tagList.length > 0 && (
            <div>
              <div className="lb-lbl">Теги и статусы<small>Tags &amp; Statuses</small></div>
              <TagLines tags={p.tagList} />
            </div>
          )}
          {p.mightList.length > 0 && (
            <div>
              <div className="lb-lbl">Могущество<small>Might</small></div>
              {p.mightList.map((m, i) => {
                const might = mightOf(m);
                return (
                  <div key={i} className="lb-mgt">
                    {might ? <MightMark might={might} label={m.name} /> : <span className="lb-mt">{m.name}</span>}
                    {m.group && <small>{m.group}</small>}
                    {m.vulnerability && <small>уязвимость: {m.vulnerability}</small>}
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/** Строки тегов: группа книги («Обольститель», «Выберите два») подписью над своими. */
function TagLines({ tags }: { tags: LitmChallengeTag[] }) {
  return (
    <div className="lb-taglines">
      {tags.map((t, i) => (
        <Fragment key={i}>
          {t.group && t.group !== tags[i - 1]?.group && <div className="lb-tgroup">{t.group}</div>}
          <div className={`lb-tagline${t.weakness ? " lb-tagline--weak" : ""}`}>
            <LitmRich text={t.text} />
            {t.weakness && <span className="lb-weak-note">слабость</span>}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** Свой вызов Мастера в прежнем текстовом виде: те же блоки, текст как есть. */
function LegacyProfile({ profile: p }: { profile: LitmChallengeProfileData }) {
  const l = p.legacy!;
  return (
    <>
      {p.description && <p className="lb-lead">{p.description}</p>}
      <div className="lb-prof">
        <div className="lb-prof__main">
          {l.threats && <><div className="lb-lbl">Угрозы и последствия</div><div className="lb-legacy"><MentionText text={l.threats} /></div></>}
          {l.specials && <><div className="lb-lbl lb-gap">Особенности</div><div className="lb-legacy"><MentionText text={l.specials} /></div></>}
          {!l.threats && !l.specials && <p className="lb-empty">Профиль не заполнен — «Править» откроет статблок.</p>}
        </div>
        <aside className="lb-prof__side">
          {p.limitList.length > 0 && (
            <div>
              <div className="lb-lbl">Пределы</div>
              {p.limitList.map((x, i) => (
                <div key={i} className="lb-lim"><b>{x.name}</b><i /><span className="lb-lim__num">{x.max}</span></div>
              ))}
            </div>
          )}
          {l.tags && <div><div className="lb-lbl">Теги и статусы</div><div className="lb-legacy"><MentionText text={l.tags} /></div></div>}
        </aside>
      </div>
    </>
  );
}

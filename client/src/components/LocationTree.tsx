import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { loadThumbnailStyles } from "../thumbnailStyles";
import type { SettingLocation } from "../types";

interface Props {
  settingId: number;
}

export function LocationTree({ settingId }: Props) {
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [rootName, setRootName] = useState("");
  const [rootKind, setRootKind] = useState("");
  const [query, setQuery] = useState("");

  function refresh() {
    api
      .get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`)
      .then(setLocations);
  }
  useEffect(refresh, [settingId]);

  async function addRoot() {
    if (!rootName.trim()) return;
    await api.post("/setting-locations", { setting_id: settingId, name: rootName, kind: rootKind });
    setRootName("");
    setRootKind("");
    refresh();
  }

  const byParent = new Map<number | null, SettingLocation[]>();
  const byId = new Map<number, SettingLocation>();
  for (const l of locations) {
    const list = byParent.get(l.parent_id) ?? [];
    list.push(l);
    byParent.set(l.parent_id, list);
    byId.set(l.id, l);
  }
  // Natural sort ("2" before "11") instead of the API's plain lexicographic
  // ORDER BY name, so numbered sub-locations list in numeric order.
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
  }
  const roots = byParent.get(null) ?? [];

  // Breadcrumb by walking parent_id up to the root — needed because search
  // results render as a flat list (a tree can't force-expand ancestors of a
  // match without converting every native <details> to controlled state),
  // so the ancestor chain is the only way to show where a match actually is.
  function breadcrumb(loc: SettingLocation): string {
    const parts: string[] = [];
    let cur: SettingLocation | undefined = loc;
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join(" → ");
  }

  const matches = query.trim()
    ? locations.filter((l) => l.name.toLowerCase().includes(query.trim().toLowerCase()))
    : null;

  return (
    <div className="stack">
      <p className="muted">
        Верхний уровень — континенты, миры, крупнейшие регионы. Разворачивайте узлы, чтобы
        добавлять вложенные локации (страны, города, районы, конкретные места).
      </p>
      <div className="row">
        <input placeholder="Название" value={rootName} onChange={(e) => setRootName(e.target.value)} />
        <input
          placeholder="Тип (континент, мир…)"
          value={rootKind}
          onChange={(e) => setRootKind(e.target.value)}
        />
        <button className="primary" onClick={addRoot}>
          Добавить
        </button>
      </div>
      <input
        placeholder="Поиск локации по названию…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches ? (
        <div className="stack" style={{ gap: 4 }}>
          {matches.map((l) => (
            <Link key={l.id} to={`/locations/${l.id}`} className="card row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{breadcrumb(l)}</span>
              {l.kind && <span className="muted">{l.kind}</span>}
            </Link>
          ))}
          {matches.length === 0 && <p className="muted">Ничего не найдено.</p>}
        </div>
      ) : (
        <div className="stack">
          {roots.map((l) => (
            <LocationNode key={l.id} location={l} byParent={byParent} onChange={refresh} />
          ))}
          {roots.length === 0 && <p className="muted">География пока пуста.</p>}
        </div>
      )}
    </div>
  );
}

export function LocationNode({
  location,
  byParent,
  onChange,
}: {
  location: SettingLocation;
  byParent: Map<number | null, SettingLocation[]>;
  onChange: () => void;
}) {
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childKind, setChildKind] = useState("");
  const children = byParent.get(location.id) ?? [];
  const thumbMode = loadThumbnailStyles().locations;
  const thumbUrl = location.thumbnail_image_url || location.avatar_image_url;
  const isBg = thumbMode === "background" && !!thumbUrl;

  async function addChild() {
    if (!childName.trim()) return;
    await api.post("/setting-locations", {
      setting_id: location.setting_id,
      parent_id: location.id,
      name: childName,
      kind: childKind,
    });
    setChildName("");
    setChildKind("");
    setAddingChild(false);
    onChange();
  }

  async function archive() {
    if (!confirm(`Отправить «${location.name}» (и вложенные) в архив?`)) return;
    await api.del(`/setting-locations/${location.id}`);
    onChange();
  }

  return (
    <details
      className={`card${isBg ? " entity-row-bg" : ""}`}
      style={isBg ? { backgroundImage: `url("${thumbUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      <summary className="row" style={{ justifyContent: "space-between" }}>
        <span className="row" style={{ alignItems: "center" }}>
          {thumbMode === "banner" && thumbUrl && <img src={thumbUrl} alt="" className="entity-row-thumb" />}
          <strong>{location.name}</strong>
          {location.kind && <span className="muted"> · {location.kind}</span>}
        </span>
        <span className="row">
          <Link to={`/locations/${location.id}`} onClick={(e) => e.stopPropagation()}>
            Открыть →
          </Link>
          <button
            onClick={(e) => {
              e.preventDefault();
              setAddingChild((v) => !v);
            }}
          >
            + Вложенная
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              archive();
            }}
          >
            🗑
          </button>
        </span>
      </summary>
      <div className="stack" style={{ marginTop: 10, paddingLeft: 16 }}>
        {addingChild && (
          <div className="row">
            <input
              placeholder="Название"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />
            <input
              placeholder="Тип (город/район/место…)"
              value={childKind}
              onChange={(e) => setChildKind(e.target.value)}
            />
            <button className="primary" onClick={addChild}>
              Добавить
            </button>
          </div>
        )}
        {children.map((c) => (
          <LocationNode key={c.id} location={c} byParent={byParent} onChange={onChange} />
        ))}
      </div>
    </details>
  );
}

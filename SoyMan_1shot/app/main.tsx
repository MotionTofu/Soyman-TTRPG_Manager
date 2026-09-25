import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../client/src/data/queryClient';
import { DndCharacterWizard } from '../../client/src/components/dnd/DndCharacterWizard';
import { DndCharacterView } from '../../client/src/components/dnd/DndCharacterForm';
import { DndRuntimeContext } from '../../client/src/components/dnd/DndRuntime';
import { SaveNotices } from '../../client/src/components/SaveNotices';
import { applyTheme, findTheme } from '../../client/src/themes';
import { emptyDndCharacter } from '@shared/dnd/normalize';
import type { DndCharacterData } from '@shared/dnd/types';
import { listCharacters, getCharacter, createCharacter, saveCharacter, importPortableRecord, updatePortableCharacter, archiveCharacter, restoreCharacter, deleteCharacter, duplicateCharacter, currentCatalog, setCurrentCatalog, hasCatalog, installCatalogRecord, getCatalogPreviews, saveCatalogPreviews, listCatalogRecords, deleteCatalogAndPreviews, saveCatalog, getCatalog, getSyncCredential, saveSyncCredential, clearSyncCredential, getSyncMeta, listSyncMeta, saveSyncMeta, parseCharacterContent, subscribeCharacterCommits, getAutoSyncEnabled, setAutoSyncEnabled, getShareTokens, saveShareToken, dropShareToken, type Character, type Catalog, type CatalogPreviewRecord, type SyncCredential, type CharacterSyncMeta } from './repository';
import { activeCharacters, archivedCharacters, canDuplicate, chainSaveOperation, displayName, wizardDraftKey } from './library.mjs';
import { createTabSync, decideRemoteUpdate, type TabSyncEvent } from './tab-sync.mjs';
import { parsePortableHtml, decidePortableImport, isCharacterUid, PORTABLE_MAX_HTML_BYTES } from './portable-import.mjs';
import { normalizeApiBase, isSyncCredential, buildPairingLink, parsePairingLink, createSyncSpace, createPairing, exchangePairing, fetchSyncStatus, disconnectSyncDevice, listRemoteCharacters, fetchRemoteSnapshot, pushRemoteSnapshot, headArtifact, putArtifact, fetchArtifact, listShares, createShare, updateShare, revokeShare } from './sync.mjs';
import { validateSyncSnapshot, decideCharacterSync, buildSyncV2Parts, pushCharacterV2, catalogArtifactHash, canonicalCatalogSlice, characterSlicePayload, canonicalPortrait, portraitArtifactHash, syncBundleError } from './sync-characters.mjs';
import { createAutoSync, type AutoSync } from './auto-sync.mjs';
import { Button } from './ui/Button';
import { ActionRow } from './ui/ActionRow';
import { Banner } from './ui/Banner';
import { selectCharacter, refreshSelectedCatalogMedia } from './transport';
import { ensureCurrentCatalog, ensureCatalogPreviews, garbageCollectCatalogs, mergePreviews } from './catalog-manager.mjs';
import { parseCatalog } from './catalog.mjs';
import { auditExport } from './export-audit.mjs';
import { gmPayload, portableFileName, portablePayload, renderPortable } from './portable.mjs';
import { Modal } from '../../client/src/components/Modal';
import { LibraryCard, useCatalogMedia } from './home';
import { QRCodeSVG } from 'qrcode.react';
import { shouldNotifyForWaiting, shouldNotifyForInstalled, createControllerChangeHandler, applyUpdateSafely } from './pwa/update.mjs';
import { readStorageStatus, requestPersistentStorage, shouldAdviseBackup, storageProtectionText } from './pwa/storage.mjs';
import type { LevelUpDraft } from '../../client/src/components/dnd/dndLevelUpDraft';
import { useDndPrefs } from '../../client/src/hooks/useDndPrefs';
import { saveDndPrefs } from '../../client/src/dndPrefs';
import '../../client/src/index.css';
import '../../client/src/dnd-sheet.css';
import '../../client/src/creature-card.css';
import '../../client/src/rich-text.css';
import '../../client/src/statblock.css';
import '../../client/src/zine.css';
import '../../client/src/fantasy-punk-skin.css';
import './tokens.css';
import './shell.css';
import './components.css';
import './wizard.css';
import './sheet.css';
import './modals.css';
import './home.css';

applyTheme(findTheme('noir'));
// Жесты листа (макет 2026-09-25, «как в тиндере»): при первом заходе на
// телефоне лист показывает, как им листать, — свайпов и двойного тапа не
// видно. Один раз на устройство; повторить — «Показать жесты» в меню «⋯».
const GESTURES_SEEN_KEY = 'oneshot-sheet-gestures-seen';
function gesturesSeen(): boolean {
  try { return localStorage.getItem(GESTURES_SEEN_KEY) === '1'; } catch { return true; }
}
function markGesturesSeen() {
  try { localStorage.setItem(GESTURES_SEEN_KEY, '1'); } catch { /* private mode */ }
}
const GESTURES: [string, string, string][] = [
  ['⇆', 'Свайп влево и вправо', 'Соседняя карта: Действия, Магия, Снаряжение…'],
  ['→', 'Свайп вправо на этой карте', 'Назад в библиотеку персонажей'],
  ['✌', 'Двойной тап по портрету', 'Вся колода веером — прыгнуть сразу на нужную'],
  ['◢', 'Уголок карты', 'Оборот: отдых, цитата, постер, правка'],
];
function SheetGestures({ onClose }: { onClose: () => void }) {
  return <div className="oneshot-gestures" role="dialog" aria-modal="true" aria-label="Как листать карты">
    <strong className="oneshot-gestures-title">Лист — это колода</strong>
    <span className="oneshot-gestures-sub">Покажем один раз. Повторить — в меню ⋯</span>
    {GESTURES.map(([icon, title, text]) => <div key={title} className="oneshot-gestures-row">
      <span aria-hidden="true">{icon}</span>
      <span><b>{title}</b>{text}</span>
    </div>)}
    <button type="button" autoFocus onClick={onClose}>Понятно</button>
  </div>;
}

// Resumable level-up drafts (C2): one localStorage record per character,
// separate from the creation-wizard key. The wizard owns the shape (see
// dndLevelUpDraft); here only load/save/remove by character id.
function levelUpDraftKey(characterId: number) {
  return `dnd-levelup-draft:character:${characterId}`;
}
function loadLevelUpDraft(characterId: number): LevelUpDraft | null {
  try {
    const raw = localStorage.getItem(levelUpDraftKey(characterId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as LevelUpDraft;
    if (!draft || draft.version !== 1 || draft.identity?.characterId !== characterId) return null;
    return draft;
  } catch {
    try { localStorage.removeItem(levelUpDraftKey(characterId)); } catch { /* private mode */ }
    return null;
  }
}
function saveLevelUpDraft(draft: LevelUpDraft) {
  try { localStorage.setItem(levelUpDraftKey(draft.identity.characterId), JSON.stringify(draft)); }
  catch { /* private mode — resume simply unavailable */ }
}
function clearLevelUpDraft(characterId: number) {
  try { localStorage.removeItem(levelUpDraftKey(characterId)); } catch { /* private mode */ }
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// Character sync engine (phases D1.2–D1.4), module scope so manual runs and
// the auto-sync orchestrator share one implementation. Pure engine: no React
// state inside, only injected hooks (markOnline/refresh). UI decisions
// (modal vs passive banner, loud vs quiet errors) belong to the callers:
// interactive runs behave exactly like the D1.3 manual button, background
// runs stay silent.
interface SyncConflict {
  uid: string;
  name: string;
  kind: 'both-changed' | 'remote-deleted-unmatched' | 'remote-deleted-local-changed' | 'local-deleted-remote-changed';
  remoteRevision: number;
  remoteDeleted: boolean;
}
interface EngineResult {
  pushed: number;
  pulled: number;
  conflicts: SyncConflict[];
  sentBytes: number;
  errors: string[];
}
function conflictEntry(uid: string, name: string, kind: SyncConflict['kind'], remoteRevision: number, remoteDeleted: boolean): SyncConflict {
  return { uid, name, kind, remoteRevision, remoteDeleted };
}
async function findLocalByUid(uid: string): Promise<Character | null> {
  const all = await listCharacters();
  const matches = all.filter((c) => c.characterUid === uid);
  return matches.length === 1 ? matches[0] : null;
}
function trackSyncMeta(uid: string, remoteRevision: number, localRevision: number | null, opts: { deletedLocally?: boolean; catalogHash?: string; portraitHash?: string | null } = {}) {
  return saveSyncMeta({
    characterUid: uid, remoteRevision, lastSyncedLocalRevision: localRevision,
    deletedLocally: opts.deletedLocally ?? false, syncedAt: new Date().toISOString(),
    ...(opts.catalogHash ? { catalogHash: opts.catalogHash } : {}),
    ...(opts.portraitHash !== undefined ? { portraitHash: opts.portraitHash } : {}),
  });
}
// v2 push: ensure missing artifacts, then the character CAS. Returns sent
// bytes for the diagnostics line. Tombstones (syncPushDelete) never upload.
async function syncPush(cred: SyncCredential, uid: string, local: Character, base: number) {
  const fresh = (await getCharacter(local.id)) ?? local;
  const catalog = fresh.catalogKey ? await getCatalog(fresh.catalogKey) : null;
  const meta = (await getSyncMeta(uid)) ?? null;
  const parts = buildSyncV2Parts(fresh, catalog, uid);
  const pushed = await pushCharacterV2(
    {
      headArtifact: (hash) => headArtifact(cred.apiBase, cred, hash),
      putArtifact: (hash, kind, payload) => putArtifact(cred.apiBase, cred, hash, kind, payload),
      putCharacter: (characterUid, body) => pushRemoteSnapshot(cred.apiBase, cred, characterUid, body),
    },
    { uid, base, parts, meta },
  );
  const confirmed = await getCharacter(local.id);
  await trackSyncMeta(uid, pushed.revision, confirmed ? confirmed.revision : fresh.revision, {
    catalogHash: pushed.catalogHash, portraitHash: pushed.portraitHash,
  });
  return pushed.uploadedBytes;
}
// Local-equivalence probes: reuse bytes we already have instead of
// re-downloading. No extra blob cache — the pinned catalog and the stored
// portrait are the cache.
function localCatalogHash(local: Character | null, catalog: Catalog | null | undefined): string | null {
  if (!local || !catalog) return null;
  try {
    return catalogArtifactHash(canonicalCatalogSlice(characterSlicePayload(local, catalog)));
  } catch {
    return null;
  }
}
function localPortraitHash(local: Character | null): string | null {
  if (!local) return null;
  const canonical = canonicalPortrait(local.portrait ?? null);
  return typeof canonical === 'string' ? portraitArtifactHash(canonical) : null;
}
async function resolveRemoteCatalog(cred: SyncCredential, uid: string, catalogHash: string, local: Character | null) {
  if (local?.catalogKey) {
    const localCatalog = await getCatalog(local.catalogKey);
    if (localCatalog && localCatalogHash(local, localCatalog) === catalogHash) return localCatalog;
  }
  const artifact = await fetchArtifact(cred.apiBase, cred, catalogHash);
  if (artifact.kind !== 'catalog' || catalogArtifactHash(artifact.payload) !== catalogHash) {
    throw syncBundleError('damaged', 'Повреждённый снимок персонажа');
  }
  return parseCatalog(artifact.payload);
}
async function resolveRemotePortrait(cred: SyncCredential, portraitHash: string | null, local: Character | null) {
  if (portraitHash === null) return null;
  if (localPortraitHash(local) === portraitHash && local) return local.portrait ?? null;
  const artifact = await fetchArtifact(cred.apiBase, cred, portraitHash);
  if (artifact.kind !== 'portrait' || typeof artifact.payload !== 'string'
    || portraitArtifactHash(artifact.payload) !== portraitHash
    || canonicalPortrait(artifact.payload) !== artifact.payload) {
    throw syncBundleError('damaged', 'Повреждённый снимок персонажа');
  }
  return artifact.payload as string;
}
async function syncPullApply(cred: SyncCredential, uid: string, remoteRevision: number, local: Character | null) {
  const snapshot = await fetchRemoteSnapshot(cred.apiBase, cred, uid);
  const parsed = validateSyncSnapshot(snapshot.payload);
  const content = parseCharacterContent(parsed.content);
  // v1 (D1.2 grace path): embedded bytes, applied exactly as before.
  if (parsed.version !== 2) {
    const catalog = parseCatalog(parsed.catalog);
    if (!local) {
      const created = await importPortableRecord({
        catalog, name: parsed.name, content, portrait: parsed.portrait, characterUid: uid,
      }, { origin: 'sync-remote' });
      await trackSyncMeta(uid, remoteRevision, created.revision);
    } else {
      const updated = await updatePortableCharacter({
        id: local.id, name: parsed.name, content, portrait: parsed.portrait, catalog,
      }, { origin: 'sync-remote' });
      await trackSyncMeta(uid, remoteRevision, updated.revision);
    }
    return;
  }
  // v2: fetch only the artifacts we don't already hold.
  const catalog = await resolveRemoteCatalog(cred, uid, parsed.catalogHash!, local);
  const portrait = await resolveRemotePortrait(cred, parsed.portraitHash, local);
  if (!local) {
    const created = await importPortableRecord({
      catalog, name: parsed.name, content, portrait, characterUid: uid,
    }, { origin: 'sync-remote' });
    await trackSyncMeta(uid, remoteRevision, created.revision, {
      catalogHash: parsed.catalogHash!, portraitHash: parsed.portraitHash,
    });
  } else {
    const updated = await updatePortableCharacter({
      id: local.id, name: parsed.name, content, portrait, catalog,
    }, { origin: 'sync-remote' });
    await trackSyncMeta(uid, remoteRevision, updated.revision, {
      catalogHash: parsed.catalogHash!, portraitHash: parsed.portraitHash,
    });
  }
}
async function syncPullDelete(uid: string, local: Character, remoteRevision: number) {
  await deleteCharacter(local.id, { origin: 'sync-remote' });
  try { localStorage.removeItem(wizardDraftKey(local.id)); } catch { /* private mode */ }
  clearLevelUpDraft(local.id);
  await trackSyncMeta(uid, remoteRevision, null);
}
async function syncPushDelete(cred: SyncCredential, uid: string, base: number) {
  const res = await pushRemoteSnapshot(cred.apiBase, cred, uid, { baseRevision: base, deleted: true });
  await trackSyncMeta(uid, res.revision, null);
}
// One engine pass over the whole space: explicit manual runs only in D1.3,
// shared with auto-sync since D1.4. Per character the pure planner decides
// push/pull/noop/conflict/delete moves from local record + sync metadata +
// remote index; one conflict never blocks the rest of the space. Throws on
// fatal errors (unreachable index); per-character failures land in errors.
async function runSyncEngine(cred: SyncCredential, hooks: { markOnline(): void; refresh(): Promise<void> }): Promise<EngineResult> {
  let pushed = 0;
  let pulled = 0;
  let sentBytes = 0;
  const conflicts: SyncConflict[] = [];
  const errors: string[] = [];
  const index = await listRemoteCharacters(cred.apiBase, cred);
  hooks.markOnline();
  const locals = await listCharacters();
  const metas = new Map((await listSyncMeta()).map((m) => [m.characterUid, m]));
  const byUid = new Map<string, Character[]>();
  for (const c of locals) {
    if (!c.characterUid) continue;
    const group = byUid.get(c.characterUid) ?? [];
    group.push(c);
    byUid.set(c.characterUid, group);
  }
  const uids = new Set<string>([
    ...byUid.keys(),
    ...index.map((e) => e.characterUid),
    ...[...metas.keys()].filter((uid) => metas.get(uid)!.deletedLocally),
  ]);
  for (const uid of uids) {
    const group = byUid.get(uid) ?? [];
    const local = group.length === 1 ? group[0] : null;
    const meta = metas.get(uid) ?? null;
    const remote = index.find((e) => e.characterUid === uid) ?? null;
    const decision = decideCharacterSync({ local, sync: meta, remote, duplicateCount: group.length });
    try {
      switch (decision.action) {
        case 'noop':
          break;
        case 'error-duplicate':
          errors.push(`«${local ? displayName(local) : uid}»: несколько локальных записей с одной identity — синхронизация пропущена.`);
          break;
        case 'push':
          if (!local) throw Error('Внутренняя ошибка синхронизации.');
          sentBytes += await syncPush(cred, uid, local, decision.base);
          pushed += 1;
          break;
        case 'pull':
          if (!remote) throw Error('Внутренняя ошибка синхронизации.');
          await syncPullApply(cred, uid, remote.revision, local);
          pulled += 1;
          break;
        case 'push-delete':
          await syncPushDelete(cred, uid, decision.base);
          pushed += 1;
          break;
        case 'pull-delete':
          if (!local || !remote) throw Error('Внутренняя ошибка синхронизации.');
          await syncPullDelete(uid, local, remote.revision);
          pulled += 1;
          break;
        case 'ack-tombstone':
          if (!remote) throw Error('Внутренняя ошибка синхронизации.');
          await trackSyncMeta(uid, remote.revision, null);
          break;
        case 'conflict': {
          const name = local ? displayName(local) : uid;
          const remoteRevision = remote ? remote.revision : 0;
          const remoteDeleted = remote ? remote.deleted : false;
          // A push raced by another device surfaces as 409 only inside
          // executors; planner-level conflicts land here directly.
          conflicts.push(conflictEntry(uid, name, decision.kind, remoteRevision, remoteDeleted));
          break;
        }
      }
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'sync-conflict' && local) {
        try {
          const latest = await fetchRemoteSnapshot(cred.apiBase, cred, uid);
          conflicts.push(conflictEntry(uid, displayName(local), latest.deleted ? 'remote-deleted-local-changed' : 'both-changed', latest.revision, latest.deleted));
        } catch {
          conflicts.push(conflictEntry(uid, local ? displayName(local) : uid, 'both-changed', remote?.revision ?? 0, remote?.deleted ?? false));
        }
      } else {
        errors.push(`«${local ? displayName(local) : uid}»: ${(e as Error).message}`);
      }
    }
  }
  await hooks.refresh();
  return { pushed, pulled, conflicts, sentBytes, errors };
}
function App() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [active, setActive] = useState<Character | null>(null);
  const activeRef = useRef<Character | null>(null);
  const [catalogKey, setCatalogKey] = useState<string | null>(null);
  const [serverCatalog, setServerCatalog] = useState(false);
  // server-config.json {sync:false}: static hosting without a SoyMan server hides device sync.
  const [syncAllowed, setSyncAllowed] = useState(true);
  const [error, setError] = useState(''); const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  // A2.3 update UX: soft banner for a staged (waiting) SW. No auto-reload.
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateApplying, setUpdateApplying] = useState(false);
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);
  const dismissedUpdateRef = useRef(false);
  const updateInitiatedRef = useRef(false);
  // A2.3 storage UX: read-only snapshot; persist() only from the button below.
  const [storageStatus, setStorageStatus] = useState({ supported: true, persisted: null as boolean | null, usageText: null as string | null });
  const [persistBusy, setPersistBusy] = useState(false);
  // D1.1 device sync: credential lives in IndexedDB settings only. No
  // characters are sent anywhere in this phase — linking only.
  const [syncCred, setSyncCred] = useState<SyncCredential | null>(null);
  const [syncOnline, setSyncOnline] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncServerInput, setSyncServerInput] = useState('');
  const [pairing, setPairing] = useState<{ link: string; expiresAt: string } | null>(null);
  const [incomingPair, setIncomingPair] = useState<{ apiBase: string; pairingToken: string } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [exportAudit, setExportAudit] = useState<ReturnType<typeof auditExport> | null>(null);
  const [exporting, setExporting] = useState(false);
  // Built GM file waiting for a fresh tap: Safari rejects share() when the
  // build outlived the original gesture.
  const [gmFile, setGmFile] = useState<File | null>(null);
  const [includeLargeCards, setIncludeLargeCards] = useState(true);
  const [managed, setManaged] = useState<'idle' | 'working' | 'ready' | 'failed'>('idle');
  const ensureRef = useRef<Promise<{ key: string | null; managed: boolean }> | null>(null);
  async function fetchManagedJson(url: string) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function fetchManagedBytes(url: string) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  async function digestManaged(bytes: Uint8Array) {
    const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Background managed-catalog install. Never blocks the home page; creation
  // awaits the shared promise when no catalog is configured yet.
  // Returns the current key plus whether it is a managed release (only managed
  // catalogs are eligible for the background previews install).
  function managedStore() {
    return {
      get: (key: string) => getCatalog(key),
      has: (key: string) => hasCatalog(key),
      install: (record: Catalog, key: string, makeCurrent: boolean) => installCatalogRecord(record, key, makeCurrent),
      getPreviews: (catalogId: string) => getCatalogPreviews(catalogId),
      savePreviews: (record: CatalogPreviewRecord) => saveCatalogPreviews(record),
      listRecords: () => listCatalogRecords(),
      deleteCatalog: (key: string) => deleteCatalogAndPreviews(key),
      getCurrent: () => currentCatalog(),
      setCurrent: (key: string) => setCurrentCatalog(key),
    };
  }
  async function ensureManaged(): Promise<{ key: string | null; managed: boolean }> {
    if (!ensureRef.current) {
      setManaged('working');
      ensureRef.current = (async () => {
        try {
          const result = await ensureCurrentCatalog({
            fetchJson: fetchManagedJson,
            fetchBytes: fetchManagedBytes,
            digestSha256: digestManaged,
            store: managedStore(),
          });
          const key = await currentCatalog();
          setCatalogKey(key || null);
          setManaged('ready');
          return { key: key || null, managed: result.status !== 'local' };
        } catch (e) {
          console.warn('managed catalog ensure failed:', e instanceof Error ? e.message : String(e));
          setManaged('failed');
          return { key: null, managed: false };
        }
      })();
    }
    return ensureRef.current;
  }
  function retryManaged() { ensureRef.current = null; void ensureManaged(); }
  // Previews are a progressive enhancement: fire-and-forget after the core is
  // ready. Failure is silent here (no banner); the next launch retries because
  // metadata.previews stays absent.
  const [media, setMedia] = useState<'idle' | 'working' | 'done'>('idle');
  const [diag, setDiag] = useState<{ version: string | null; count: number } | null>(null);
  async function refreshDiag() {
    try {
      const [records, current] = await Promise.all([listCatalogRecords(), currentCatalog()]);
      const me = records.find(r => r.key === current);
      setDiag({ version: me?.catalog.metadata?.catalogVersion ?? null, count: records.length });
    } catch { /* diagnostics are best-effort */ }
  }
  const mediaRef = useRef<Promise<void> | null>(null);
  async function ensureMedia(catalogId: string) {
    if (!mediaRef.current) {
      setMedia('working');
      mediaRef.current = (async () => {
        try {
          const result = await ensureCatalogPreviews({
            fetchJson: fetchManagedJson,
            fetchBytes: fetchManagedBytes,
            digestSha256: digestManaged,
            store: managedStore(),
          }, catalogId);
          if (result.status === 'installed') {
            // The selected catalog record itself did not change (previews live
            // in their own store), so only the transport media map is refreshed;
            // entryCache subscribers then refetch with images, no reload.
            await refreshSelectedCatalogMedia();
            // Hot refresh without reload: entryCache subscribers (sheet live
            // entries) refetch invalidated ids; readResource caches go stale.
            // Wizard option grids are one-shot useState snapshots and pick the
            // images up on next open — documented, no second cache introduced.
            await queryClient.invalidateQueries({ predicate: (query) => {
              const k = query.queryKey as readonly unknown[];
              if (k[0] === 'entity' && k[1] === 'compendium_entry') return true;
              if (k[0] === 'resource' && typeof k[1] === 'string'
                && (k[1] === '/systems' || k[1].startsWith('/systems/'))) return true;
              return false;
            } });
          }
        } catch { /* secondary failure stays silent */ }
        finally { setMedia('done'); }
      })();
    }
    return mediaRef.current;
  }
  function launchMedia(key: string | null, managed: boolean) {
    if (key && managed) void ensureMedia(key);
  }
  // One tap for the player (grilling 2026-09-23): the share sheet with the
  // GM copy; plain download where the browser cannot share files.
  async function shareGmFile(file: File) {
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: file.name }); setGmFile(null); setStatus('Файл для Мастера отправлен'); }
      catch (e) {
        if ((e as Error).name === 'AbortError') setGmFile(null);
        else if ((e as Error).name === 'NotAllowedError') setGmFile(file);
        else throw e;
      }
      return;
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setGmFile(null); setStatus('Файл для Мастера скачан — отправьте его в чат');
  }
  async function exportHtml(forGm = false, target?: Character) {
    setExporting(true); setError(''); if (target) setExportingFor(`${target.id}:${forGm ? 'gm' : 'html'}`);
    try {
      const c = target ?? activeRef.current; if (!c?.content) return;
      // Lazy UID backfill (phase B1.2): old records get their stable identity
      // on first export, persisted before the payload is built, so every
      // export of one character carries one characterUid.
      let source = c;
      if (!isCharacterUid(source.characterUid)) {
        const saved = await saveCharacter({ ...source, characterUid: crypto.randomUUID(), revision: target ? source.revision : revision.current });
        source = { ...saved, revision: saved.revision };
        if (target) void refreshCharacters();
        else { revision.current = saved.revision; activeRef.current = source; setActive(source); }
      }
      const catalog = source.catalogKey ? (await getCatalog(source.catalogKey)) ?? null : null;
      const payload = forGm ? gmPayload(source, catalog) : portablePayload(source, catalog);
      const response = await fetch('/standalone-template.html');
      if (!response.ok) throw Error('Не удалось загрузить оболочку автономного чарника.');
      const html = renderPortable(await response.text(), payload);
      if (forGm) { if (target) setGmFor(target.id); await shareGmFile(new File([html], portableFileName(displayName(source)), { type: 'text/html' })); return; }
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const link = document.createElement('a'); link.href = url; link.download = `OneShot-${source.id}.html`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError((e as Error).message); }
    finally { setExporting(false); setExportingFor(null); }
  }
  async function inspectExport() {
    try {
      const c = activeRef.current; if (!c?.content) return;
      setExportAudit(auditExport(c, c.catalogKey ? (await getCatalog(c.catalogKey)) ?? null : null));
    } catch (e) { setError((e as Error).message); }
  }
  const [name, setName] = useState('');
  const queue = useRef(Promise.resolve()); const revision = useRef(0); const failed = useRef(false);
  const pending = useRef(0);
  // Cross-tab invalidation (phase C3): one channel per tab, created once on
  // mount. Events carry ids/revisions only — the record is always re-read
  // from IndexedDB, and reads never publish, so no loop is possible.
  const tabSyncRef = useRef<ReturnType<typeof createTabSync> | null>(null);
  // Remote event arrived while a local save was in flight: re-read after the
  // queue settles instead of swapping state mid-write.
  const remoteRefreshPending = useRef(false);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pending.current || failed.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  // Re-reads the open character after a remote invalidation. Adopts only a
  // strictly newer revision; a failed local save keeps its unsaved work and
  // error banner instead of being silently overwritten by the winner.
  async function refreshOpenCharacter() {
    const open = activeRef.current;
    if (!open || failed.current) return;
    try {
      const latest = await getCharacter(open.id);
      if (!latest || latest.revision <= revision.current) return;
      revision.current = latest.revision;
      activeRef.current = latest;
      setActive(latest);
      setStatus('Сохранено на устройстве');
    } catch { /* best-effort refresh; CAS still guards every write */ }
  }
  function settleRemoteRefresh() {
    if (!remoteRefreshPending.current || pending.current > 0) return;
    remoteRefreshPending.current = false;
    if (failed.current) return;
    void refreshOpenCharacter();
  }
  function handleTabSyncEvent(message: TabSyncEvent) {
    if (message.type === 'character-deleted') {
      void refreshCharacters().catch(() => {});
      if (activeRef.current?.id === message.characterId) {
        setStatus('Персонаж удалён в другой вкладке.');
        location.assign('/');
      }
      return;
    }
    void refreshCharacters().catch(() => {});
    const open = activeRef.current;
    if (!open || open.id !== message.characterId) return;
    const decision = decideRemoteUpdate({
      hasPendingSave: pending.current > 0,
      hasUnsavedFailure: failed.current,
      knownRevision: revision.current,
      remoteRevision: message.revision,
    });
    if (decision === 'defer') remoteRefreshPending.current = true;
    else if (decision === 'adopt') void refreshOpenCharacter();
  }
  useEffect(() => {
    tabSyncRef.current = createTabSync({ onEvent: (message) => handleTabSyncEvent(message) });
    return () => { tabSyncRef.current?.close(); tabSyncRef.current = null; };
  }, []);
  // Production PWA registration + soft update banner (phase A2.3). A staged
  // waiting SW notifies via banner; first install (no controller) stays
  // silent. Failures stay in the console and never break the app; the SW is a
  // build artifact (dev has nothing to register).
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
    // Reloads only the tab where the player pressed "Обновить" — first-install
    // claim and neighbour tabs never reload on their own.
    const onControllerChange = createControllerChangeHandler({
      reload: () => window.location.reload(),
      isUpdateInitiated: () => updateInitiatedRef.current,
    });
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    let disposed = false;
    const register = () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
        if (disposed) return;
        swRegRef.current = reg;
        if (!dismissedUpdateRef.current && shouldNotifyForWaiting({
          hasWaiting: Boolean(reg.waiting),
          hasController: Boolean(navigator.serviceWorker.controller),
        })) setUpdateAvailable(true);
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (disposed || dismissedUpdateRef.current) return;
            if (worker.state === 'installed' && shouldNotifyForInstalled({
              hasController: Boolean(navigator.serviceWorker.controller),
            })) setUpdateAvailable(true);
          });
        });
      }).catch((e) => console.warn('SW registration failed:', e));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => {
      disposed = true;
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);
  // Read-only storage snapshot (persisted + estimate). Never calls persist(),
  // so no permission prompt appears at startup. Unsupported browsers keep the
  // neutral initial state.
  useEffect(() => {
    (async () => {
      try {
        if ('storage' in navigator) setStorageStatus(await readStorageStatus(navigator.storage));
        else setStorageStatus({ supported: false, persisted: null, usageText: null });
      } catch { /* neutral fallback stays */ }
    })();
  }, []);
  // Sync init: load the local credential, verify it quietly, and notice an
  // incoming pairing invite. Offline or failure keeps local-only mode.
  // Auto-sync preference is restored too: connected + enabled reactivates
  // the orchestrator with one startup sync for the baseline.
  useEffect(() => {
    (async () => {
      let activeCred: SyncCredential | null = null;
      try {
        const stored = await getSyncCredential();
        if (stored && isSyncCredential(stored)) {
          setSyncCred(stored);
          activeCred = stored;
          try {
            await fetchSyncStatus(stored.apiBase, stored);
            setSyncOnline(true);
          } catch (e) {
            if ((e as Error).message === 'NETWORK_UNREACHABLE') setSyncOnline(false);
            else { await clearSyncCredential(); setSyncCred(null); activeCred = null; }
          }
        }
      } catch { /* local-only fallback stays */ }
      const auto = await getAutoSyncEnabled().catch(() => false);
      setAutoEnabled(auto);
      getAutoSync().setEnabled(auto && activeCred !== null);
      if (auto && activeCred) void getAutoSync().request({ immediate: true }).catch(() => {});
      const invite = parsePairingLink(location.href);
      if (invite) {
        try {
          const stored = await getSyncCredential();
          if (!stored || !isSyncCredential(stored)) setIncomingPair(invite);
          else cleanPairUrl();
        } catch { setIncomingPair(invite); }
      }
    })();
  }, []);
  function cleanPairUrl() {
    try {
      const url = new URL(location.href);
      url.searchParams.delete('api');
      const search = url.searchParams.toString();
      history.replaceState(null, '', url.pathname + (search ? `?${search}` : ''));
    } catch { /* URL stays as-is */ }
  }
  // Auto-sync triggers (phase D1.4): durable local commits (repository
  // notifies with origin — remote pulls and bare BC receives never trigger),
  // browser online, and tab foreground. No polling, no background sync.
  useEffect(() => {
    const unsubscribe = subscribeCharacterCommits(({ origin }) => getAutoSync().notifyCommit(origin));
    const onOnline = () => getAutoSync().notifyOnline();
    const onForeground = () => { if (!document.hidden) getAutoSync().notifyVisible(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      unsubscribe();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, []);
  const importFile = useRef<HTMLInputElement>(null); const restoreFile = useRef<HTMLInputElement>(null);
  const portableFile = useRef<HTMLInputElement>(null);
  // Legacy /catalog.json (deprecated, phase A2.3 audit): server-shared catalog
  // fallback. The managed flow (manifest/core/previews) is the default; this
  // path stays only for old deployments. Physical removal is a separate
  // micro-phase after the old-client grace period — do not delete here.
  async function connectServerCatalog() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/catalog.json', { cache: 'no-store' });
      if (!response.ok) throw Error('Не удалось загрузить общий справочник. Повторите подключение.');
      const catalog = parseCatalog(await response.json());
      const key = await saveCatalog(catalog);
      setCatalogKey(key);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function open(id: number) {
    const c = await getCharacter(id); if (!c) throw Error('Персонаж не найден');
    await selectCharacter(id); revision.current = c.revision; activeRef.current = c; setActive(c); setWizard(!c.content);
    setStatus('Сохранено на устройстве');
  }
  // Catalog GC via the existing helper: removes a managed slice exactly when
  // it is unreferenced and non-current; legacy/custom/shared records are
  // always kept. Runs after setup and after character deletion.
  function collectGarbage() {
    void garbageCollectCatalogs({
      fetchJson: fetchManagedJson,
      fetchBytes: fetchManagedBytes,
      digestSha256: digestManaged,
      store: managedStore(),
      listCharacters: () => listCharacters(),
    });
    void refreshDiag();
  }
  useEffect(() => {
    (async () => {
      setCharacters(await listCharacters()); const key = await currentCatalog(); setCatalogKey(key || null);
      if (!import.meta.env.DEV) {
        try {
          const response = await fetch('/server-config.json', { cache: 'no-store' });
          const config = response.ok ? await response.json() : null;
          if (config?.catalog === '/catalog.json') setServerCatalog(true);
          if (config?.sync === false) setSyncAllowed(false);
        } catch { /* Local characters remain available when the server is unreachable. */ }
      }
      const id = Number(new URLSearchParams(location.search).get('character'));
      if (id) await open(id);
      setReady(true);
      // Managed catalog installs in the background; previews follow after the
      // core. GC runs only once a usable catalog is established, so a failed
      // install can never delete the previous state. Local characters and the
      // manual import work regardless.
      void ensureManaged().then(({ key, managed }) => {
        launchMedia(key, managed);
        if (key) collectGarbage();
        else void refreshDiag();
      });
    })().catch(e => { setError(e.message); setReady(true); });
  }, []);
  function update(patch: Partial<DndCharacterData>) {
    const old = activeRef.current; if (!old?.content) return;
    persist({ ...old, content: { ...old.content, ...patch } });
  }
  // Портрет из «Редактировать» — той же очередью, что правки листа: мимо неё
  // следующая правка упёрлась бы в устаревшую ревизию.
  async function uploadPortrait(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw Error('Нужна картинка PNG, JPEG или WebP до 15 МБ');
    const portrait = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
    const old = activeRef.current; if (!old) return;
    persist({ ...old, portrait });
  }
  function persist(next: Character) {
    activeRef.current = next; setActive(next);
    if (failed.current) { setStatus('Не сохранено'); return; }
    pending.current += 1;
    setStatus('Сохраняем на устройстве…');
    queue.current = queue.current.then(async () => {
      if (failed.current) { pending.current -= 1; return; }
      try {
        const saved = await saveCharacter({ ...next, revision: revision.current }); revision.current = saved.revision;
        if (activeRef.current) activeRef.current.revision = saved.revision;
      } catch (e) { failed.current = true; setStatus('Не сохранено'); setError((e as Error).message); }
      finally { pending.current -= 1; if (!failed.current && !pending.current) setStatus('Сохранено на устройстве'); settleRemoteRefresh(); }
    });
  }
  // Durable level-up commit (C2 correctness fix): unlike update() above,
  // which resolves at enqueue, this returns a promise settling exactly with
  // the repository CAS of THIS operation. The wizard awaits it and clears
  // the draft only after a real commit; on CAS conflict it rejects, the
  // draft stays, and the user retries. The shared queue itself never
  // rejects, so fire-and-forget edits keep flowing.
  async function applyLevelUp(patch: Partial<DndCharacterData>): Promise<void> {
    const old = activeRef.current;
    if (!old?.content) throw Error('Нет данных персонажа для повышения уровня');
    if (failed.current) throw Error('Не сохранено — скачайте резервную копию перед обновлением.');
    const next = { ...old, content: { ...old.content, ...patch } };
    activeRef.current = next; setActive(next);
    pending.current += 1;
    setStatus('Сохраняем на устройстве…');
    const chained = chainSaveOperation(queue.current, async () => {
      if (failed.current) throw Error('Не сохранено');
      try {
        const saved = await saveCharacter({ ...next, revision: revision.current });
        revision.current = saved.revision;
        if (activeRef.current) activeRef.current.revision = saved.revision;
        return saved;
      } catch (e) {
        failed.current = true; setStatus('Не сохранено'); setError((e as Error).message);
        throw e;
      } finally {
        pending.current -= 1;
        if (!failed.current && !pending.current) setStatus('Сохранено на устройстве');
        settleRemoteRefresh();
      }
    });
    queue.current = chained.chain;
    await chained.outcome;
  }
  // Explicit "Обновить": flush the existing save queue first so no HP or
  // resources are lost to the reload, then wake the waiting SW. The single
  // reload happens on controllerchange via the guard above.
  async function applyAppUpdate() {
    if (updateApplying) return;
    if (failed.current) { setError('Не сохранено — скачайте резервную копию перед обновлением.'); return; }
    setUpdateApplying(true);
    // Armed before posting so the flag is set even if activation wins the
    // race; disarmed below whenever nothing was posted to the worker.
    updateInitiatedRef.current = true;
    try {
      const result = await applyUpdateSafely({
        hasWaitingWorker: Boolean(swRegRef.current?.waiting),
        postSkipWaiting: (message) => swRegRef.current?.waiting?.postMessage(message),
        waitForSafe: async () => {
          try { await queue.current; } catch { /* save error surfaces via failed flag */ }
          if (failed.current || pending.current > 0) return { ok: false, reason: 'unsaved-changes' };
          return { ok: true };
        },
      });
      if (result.ok) return; // controllerchange reloads once.
      updateInitiatedRef.current = false;
      setUpdateApplying(false);
      if (result.reason === 'no-waiting-worker') setUpdateAvailable(false);
      else setError('Не сохранено — скачайте резервную копию перед обновлением.');
    } catch (e) { setError((e as Error).message); setUpdateApplying(false); updateInitiatedRef.current = false; }
  }
  // Explicit "Защитить данные": the only place persist() is ever called.
  async function protectData() {
    if (!('storage' in navigator)) return;
    setPersistBusy(true);
    try {
      const result = await requestPersistentStorage(navigator.storage);
      if (result.ok) setStorageStatus((s) => ({ ...s, persisted: true }));
    } finally { setPersistBusy(false); }
  }
  // Optional device sync (D1.1): linking only, no character data ever sent.
  // The credential (including deviceToken) lives in IndexedDB settings and
  // never reaches portable HTML, backups, BroadcastChannel or logs.
  function syncFailure(e: unknown) {
    const message = (e as Error).message;
    if (message === 'NETWORK_UNREACHABLE') {
      setSyncOnline(false);
      return 'Нет связи с сервером синхронизации.';
    }
    return message;
  }
  async function enableSync() {
    setSyncBusy(true); setSyncError('');
    try {
      const apiBase = normalizeApiBase(syncServerInput);
      const issued = await createSyncSpace(apiBase);
      const credential: SyncCredential = {
        version: 1, apiBase, spaceId: issued.spaceId, deviceId: issued.deviceId,
        deviceToken: issued.deviceToken, linkedAt: new Date().toISOString(),
      };
      await saveSyncCredential(credential);
      setSyncCred(credential); setSyncOnline(true); setSyncServerInput('');
      const autoAfterEnable = await getAutoSyncEnabled().catch(() => false);
      setAutoEnabled(autoAfterEnable);
      getAutoSync().setEnabled(autoAfterEnable);
      if (autoAfterEnable) void getAutoSync().request({ immediate: true }).catch(() => {});
    } catch (e) { setSyncError(syncFailure(e)); }
    finally { setSyncBusy(false); }
  }
  async function showPairing() {
    if (!syncCred) return;
    setSyncBusy(true); setSyncError('');
    try {
      const issued = await createPairing(syncCred.apiBase, syncCred);
      setSyncOnline(true);
      setPairing({
        link: buildPairingLink({
          appOrigin: location.origin, appPath: location.pathname,
          apiBase: syncCred.apiBase, pairingToken: issued.pairingToken,
        }),
        expiresAt: issued.expiresAt,
      });
    } catch (e) { setSyncError(syncFailure(e)); }
    finally { setSyncBusy(false); }
  }
  async function copyPairingLink() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.link);
    } catch {
      setSyncError('Не удалось скопировать ссылку.');
    }
  }
  async function acceptPairing() {
    if (!incomingPair) return;
    setSyncBusy(true); setSyncError('');
    try {
      const issued = await exchangePairing(incomingPair.apiBase, incomingPair.pairingToken);
      const credential: SyncCredential = {
        version: 1, apiBase: incomingPair.apiBase, spaceId: issued.spaceId, deviceId: issued.deviceId,
        deviceToken: issued.deviceToken, linkedAt: new Date().toISOString(),
      };
      await saveSyncCredential(credential);
      setSyncCred(credential); setSyncOnline(true);
      setIncomingPair(null); cleanPairUrl();
      const autoAfterPair = await getAutoSyncEnabled().catch(() => false);
      setAutoEnabled(autoAfterPair);
      getAutoSync().setEnabled(autoAfterPair);
      if (autoAfterPair) void getAutoSync().request({ immediate: true }).catch(() => {});
    } catch (e) { setSyncError(syncFailure(e)); }
    finally { setSyncBusy(false); }
  }
  function declinePairing() {
    setIncomingPair(null); cleanPairUrl();
  }
  async function disconnectSync() {
    if (!syncCred) return;
    setSyncBusy(true); setSyncError('');
    try {
      await disconnectSyncDevice(syncCred.apiBase, syncCred);
      await clearSyncCredential();
      // Cancel pending debounce; no more auto runs without a credential.
      getAutoSync().setEnabled(false);
      setAutoConflictNotice(null); setAutoStatus('');
      setSyncCred(null); setConfirmUnlink(false); setPairing(null);
    } catch (e) {
      // Offline or failed revoke: keep the credential so the user can retry
      // later instead of silently stranding a live server device.
      setSyncError(`${syncFailure(e)} Credential сохранён, попробуйте позже.`);
    }
    finally { setSyncBusy(false); }
  }
  // Character sync engine (phase D1.2): explicit manual runs only. Per
  // character the pure planner decides push/pull/noop/conflict/delete moves
  // from local record + sync metadata + remote index; one conflict never
  // blocks the rest of the space.
  // Character sync: the engine above runs on manual press and, when opted
  // in, through the auto-sync orchestrator (debounce, one-in-flight,
  // rerun). Interactive runs behave exactly like the D1.3 manual button
  // (modal conflicts, loud errors); background runs stay passive.
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ at: string; pushed: number; pulled: number; conflicts: number; sentBytes: number; errors: string[] } | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[] | null>(null);
  const [resolvingUid, setResolvingUid] = useState<string | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [autoStatus, setAutoStatus] = useState('');
  const [autoConflictNotice, setAutoConflictNotice] = useState<SyncConflict[] | null>(null);
  const syncCredRef = useRef<SyncCredential | null>(null);
  useEffect(() => { syncCredRef.current = syncCred; }, [syncCred]);
  const autoSyncRef = useRef<AutoSync | null>(null);
  // Background engine entry for the orchestrator. Never throws: fatal
  // background errors become the passive status line (no modal, no loud
  // error). Interactive runs rethrow for the manual wrapper.
  async function autoRun(interactive: boolean): Promise<EngineResult> {
    const cred = syncCredRef.current;
    if (!cred) return { pushed: 0, pulled: 0, conflicts: [], sentBytes: 0, errors: [] };
    if (interactive) {
      return runSyncEngine(cred, { markOnline: () => setSyncOnline(true), refresh: refreshCharacters });
    }
    setAutoSyncing(true);
    try {
      const result = await runSyncEngine(cred, { markOnline: () => setSyncOnline(true), refresh: refreshCharacters });
      setAutoStatus('Синхронизировано');
      // A clean run clears a stale notice (the conflict is gone); a
      // conflicted run replaces it. Never a modal mid-game.
      setAutoConflictNotice(result.conflicts.length ? result.conflicts : null);
      return result;
    } catch (e) {
      if ((e as Error).message === 'NETWORK_UNREACHABLE') setSyncOnline(false);
      setAutoStatus('Не удалось синхронизировать. Локальные данные сохранены.');
      return { pushed: 0, pulled: 0, conflicts: [], sentBytes: 0, errors: [(e as Error).message] };
    }
    finally { setAutoSyncing(false); }
  }
  function getAutoSync(): AutoSync {
    if (!autoSyncRef.current) {
      autoSyncRef.current = createAutoSync({
        schedule: (fn, ms) => { const id = setTimeout(fn, ms); return { cancel: () => clearTimeout(id) }; },
        now: () => Date.now(),
        isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
        run: (interactive) => autoRun(interactive),
      });
    }
    return autoSyncRef.current;
  }
  // Manual button: always available (auto on or off, after errors, after
  // offline). Rides the same orchestrator lock: while a background run is
  // in flight the press coalesces behind it, then runs interactively.
  async function syncNow() {
    if (!syncCred || syncing) return;
    setSyncing(true); setSyncError(''); setSyncResult(null); setSyncConflicts(null);
    try {
      const result = await getAutoSync().request({ immediate: true, interactive: true }) as EngineResult;
      setSyncResult({
        at: new Date().toISOString(), pushed: result.pushed, pulled: result.pulled,
        conflicts: result.conflicts.length, sentBytes: result.sentBytes, errors: result.errors,
      });
      if (result.conflicts.length) setSyncConflicts(result.conflicts);
      else setAutoConflictNotice(null);
    } catch (e) {
      setSyncError(syncFailure(e));
    }
    finally { setSyncing(false); }
  }
  async function dropConflict(uid: string) {
    setSyncConflicts((list) => {
      const next = (list ?? []).filter((c) => c.uid !== uid);
      return next.length ? next : null;
    });
    setAutoConflictNotice((list) => {
      const next = (list ?? []).filter((c) => c.uid !== uid);
      return next.length ? next : null;
    });
    setSyncResult((prev) => (prev ? { ...prev, conflicts: Math.max(0, prev.conflicts - 1) } : prev));
  }
  // Opt-in toggle (§1): explicit user act. ON saves the setting and takes
  // one immediate background sync for the baseline; OFF only stops future
  // triggers (the manual button keeps working).
  async function toggleAutoSync(checked: boolean) {
    setAutoEnabled(checked);
    try { await setAutoSyncEnabled(checked); } catch { /* memory state stays for this session */ }
    getAutoSync().setEnabled(checked && syncCred !== null);
    if (checked && syncCred) void getAutoSync().request({ immediate: true }).catch(() => {});
  }
  // Read-only GM sharing (phase D2.1): publish an explicit snapshot, refresh
  // it, or revoke the link. One active share per character; the raw token is
  // shown once and kept in local settings (the server stores only its hash).
  // The link host is the sync apiBase itself — the main SoyMan server.
  interface ShareTarget { id: number; uid: string; name: string }
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareServerActive, setShareServerActive] = useState(false);
  const [shareUpdatedAt, setShareUpdatedAt] = useState<string | null>(null);
  function shareLink(): string | null {
    if (!syncCred || !shareToken) return null;
    return `${syncCred.apiBase}/share/character/${shareToken}`;
  }
  async function openShare(c: Character) {
    if (!c.characterUid) return;
    setShareTarget({ id: c.id, uid: c.characterUid, name: displayName(c) });
    setShareBusy(true); setShareError(''); setShareToken(null);
    setShareServerActive(false); setShareUpdatedAt(null);
    try {
      const local = (await getShareTokens().catch((): Record<string, string> => ({})))[c.characterUid] ?? null;
      const remote = syncCred ? await listShares(syncCred.apiBase, syncCred) : [];
      const entry = remote.find((e) => e.characterUid === c.characterUid) ?? null;
      if (local && entry) {
        setShareToken(local); setShareServerActive(true); setShareUpdatedAt(entry.updatedAt);
      } else {
        // Token lost (or published from a sibling device): the link itself
        // is unrecoverable, but the space-authed record is still manageable.
        if (local) await dropShareToken(c.characterUid).catch(() => {});
        setShareServerActive(entry !== null);
        setShareUpdatedAt(entry ? entry.updatedAt : null);
      }
    } catch (e) { setShareError(syncFailure(e)); }
    finally { setShareBusy(false); }
  }
  // Ensure the referenced artifacts exist in the space (same helpers as
  // sync push; HEAD keeps it a no-op when already uploaded). Never touches
  // the sync_characters rows — sharing is not syncing.
  async function ensureShareArtifacts(cred: SyncCredential, parts: { catalogHash: string; catalogPayload: unknown; portraitHash: string | null; portraitPayload: string | null }) {
    const needed: [string, 'catalog' | 'portrait', unknown][] = [
      [parts.catalogHash, 'catalog', parts.catalogPayload],
    ];
    if (parts.portraitHash && parts.portraitPayload) needed.push([parts.portraitHash, 'portrait', parts.portraitPayload]);
    for (const [hash, kind, payload] of needed) {
      if (await headArtifact(cred.apiBase, cred, hash)) continue;
      await putArtifact(cred.apiBase, cred, hash, kind, payload);
    }
  }
  async function publishShare() {
    if (!syncCred || !shareTarget) return;
    setShareBusy(true); setShareError('');
    try {
      const local = (await getCharacter(shareTarget.id)) ?? null;
      if (!local?.content || !local.characterUid) throw Error('Персонаж не найден');
      const catalog = local.catalogKey ? await getCatalog(local.catalogKey) : null;
      const parts = buildSyncV2Parts(local, catalog, shareTarget.uid);
      await ensureShareArtifacts(syncCred, parts);
      const created = await createShare(syncCred.apiBase, syncCred, shareTarget.uid, parts.document);
      if (!created.shareToken) throw Error('Не удалось создать ссылку');
      await saveShareToken(shareTarget.uid, created.shareToken);
      setShareToken(created.shareToken); setShareServerActive(true); setShareUpdatedAt(created.updatedAt);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'share-exists') {
        setShareError('У персонажа уже есть активная ссылка.');
        const entry = (await listShares(syncCred.apiBase, syncCred).catch(() => []))
          .find((s) => s.characterUid === shareTarget.uid) ?? null;
        setShareServerActive(entry !== null);
        setShareUpdatedAt(entry ? entry.updatedAt : null);
      } else setShareError(syncFailure(e));
    }
    finally { setShareBusy(false); }
  }
  async function refreshShare() {
    if (!syncCred || !shareTarget) return;
    setShareBusy(true); setShareError('');
    try {
      const local = (await getCharacter(shareTarget.id)) ?? null;
      if (!local?.content || !local.characterUid) throw Error('Персонаж не найден');
      const catalog = local.catalogKey ? await getCatalog(local.catalogKey) : null;
      const parts = buildSyncV2Parts(local, catalog, shareTarget.uid);
      await ensureShareArtifacts(syncCred, parts);
      const updated = await updateShare(syncCred.apiBase, syncCred, shareTarget.uid, parts.document);
      setShareUpdatedAt(updated.updatedAt); setShareServerActive(true);
    } catch (e) { setShareError(syncFailure(e)); }
    finally { setShareBusy(false); }
  }
  async function unshare() {
    if (!syncCred || !shareTarget) return;
    setShareBusy(true); setShareError('');
    try {
      await revokeShare(syncCred.apiBase, syncCred, shareTarget.uid);
      await dropShareToken(shareTarget.uid).catch(() => {});
      setShareToken(null); setShareServerActive(false); setShareUpdatedAt(null);
    } catch (e) { setShareError(syncFailure(e)); }
    finally { setShareBusy(false); }
  }
  async function copyShareLink() {
    const link = shareLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      setShareError('Не удалось скопировать ссылку.');
    }
  }
  // "Оставить версию этого устройства" (и "Удалить везде" для local-delete):
  // свежий remote revision, затем сознательный overwrite.
  async function resolveConflictKeepLocal(uid: string) {
    if (!syncCred) return;
    setResolvingUid(uid); setSyncError('');
    try {
      const local = await findLocalByUid(uid);
      const latest = await fetchRemoteSnapshot(syncCred.apiBase, syncCred, uid);
      if (local) {
        const bytes = await syncPush(syncCred, uid, local, latest.revision);
        setSyncResult((prev) => (prev ? { ...prev, pushed: prev.pushed + 1, sentBytes: prev.sentBytes + bytes } : prev));
      } else {
        await syncPushDelete(syncCred, uid, latest.revision);
        setSyncResult((prev) => (prev ? { ...prev, pushed: prev.pushed + 1 } : prev));
      }
      await dropConflict(uid);
      await refreshCharacters();
    } catch (e) { setSyncError(syncFailure(e)); }
    finally { setResolvingUid(null); }
  }
  // "Использовать версию с сервера" (и "Удалить и здесь" для tombstone):
  // pull-apply поверх локальной записи с тем же local id.
  async function resolveConflictUseServer(uid: string) {
    if (!syncCred) return;
    setResolvingUid(uid); setSyncError('');
    try {
      const latest = await fetchRemoteSnapshot(syncCred.apiBase, syncCred, uid);
      const local = await findLocalByUid(uid);
      if (latest.deleted) {
        if (local) await syncPullDelete(uid, local, latest.revision);
        else await trackSyncMeta(uid, latest.revision, null);
      } else if (local) {
        await syncPullApply(syncCred, uid, latest.revision, local);
      } else {
        await syncPullApply(syncCred, uid, latest.revision, null);
      }
      setSyncResult((prev) => (prev ? { ...prev, pulled: prev.pulled + 1 } : prev));
      await dropConflict(uid);
      await refreshCharacters();
    } catch (e) { setSyncError(syncFailure(e)); }
    finally { setResolvingUid(null); }
  }
  async function create(blank = false) {
    setBusy(true); setError('');
    try {
      let key = catalogKey;
      let managed = true;
      if (!key) {
        setStatus('Подготавливаем создание персонажа…');
        ({ key, managed } = await ensureManaged());
        if (key) setStatus('Сохранено на устройстве');
      }
      if (!key) throw Error('Для первого создания персонажа нужно один раз загрузить игровые данные.');
      launchMedia(key, managed);
      let c = await createCharacter(name.trim() || 'Новый персонаж', key);
      if (blank) { const content = emptyDndCharacter(); content.characterName = c.name; content.systemId = 1; c = await saveCharacter({ ...c, content }); }
      location.assign(`/?character=${c.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function backup() {
    try {
      const c = activeRef.current; if (!c?.content) return;
      const raw = c.catalogKey ? structuredClone(await getCatalog(c.catalogKey)) : null;
      // Backup keeps the legacy logical shape (entries with preview URLs):
      // managed media is merged back from its own store before serializing.
      // The backup/restore format itself is unchanged.
      let catalog = raw;
      if (catalog && catalog.metadata?.id === c.catalogKey) {
        const previews = await getCatalogPreviews(c.catalogKey!);
        if (previews) catalog = mergePreviews(catalog, previews.images);
      }
      if (catalog && !includeLargeCards) for (const entry of catalog.entries) delete entry.avatar_large_url;
      download({ format: 'soyman-1shot-backup', version: 1, character: { ...c, revision: revision.current }, catalog }, `oneshot-${c.id}.json`);
    } catch (e) { setError((e as Error).message); }
  }
  async function readFile(file: File) { if (file.size > 256 * 1024 * 1024) throw Error('Файл превышает 256 МБ'); return JSON.parse(await file.text()); }
  // Portable HTML import (phase B1.1): every import mints a new local
  // character pinned to its own catalog slice. Internal codes stay in the
  // console/tests; the player only sees plain messages.
  function portableImportMessage(error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === 'unsupported-file') return 'Это не файл персонажа SoyMan.';
    if (code === 'invalid-character' || code === 'invalid-catalog') return 'Не удалось восстановить игровые данные персонажа.';
    return 'Файл персонажа повреждён или имеет неподдерживаемую версию.';
  }
  async function importPortableFile(file: File) {
    setBusy(true); setError('');
    try {
      // Content is the truth, not the browser MIME; the byte cap rejects
      // giant arbitrary files before any parsing.
      if (file.size > PORTABLE_MAX_HTML_BYTES) throw Object.assign(Error('too large'), { code: 'damaged-payload' });
      const parsed = parsePortableHtml(await file.text());
      // Full D&D normalization via the existing mechanism — same gate as the
      // JSON restore. Nothing is written to IDB before this passes.
      const content = parseCharacterContent(parsed.content);
      // Phase B1.2 identity: v1 (or unknown UID) imports as a new character
      // preserving/assigning identity; a known UID asks the player.
      const decision = decidePortableImport({ characterUid: parsed.characterUid, characters: await listCharacters() });
      if (decision.action === 'create') {
        const c = await importPortableRecord({ catalog: parsed.catalog, name: parsed.name, content, portrait: parsed.portrait, characterUid: parsed.characterUid });
        location.assign(`/?character=${c.id}`);
        return;
      }
      const pending = { name: parsed.name, content, portrait: parsed.portrait, catalog: parsed.catalog, characterUid: parsed.characterUid };
      if (decision.action === 'confirm') {
        const m = decision.match;
        setPortableMatches([{ id: m.id, name: m.content?.characterName || m.name }]);
      } else {
        setPortableMatches(decision.matches.map((m) => ({ id: m.id, name: m.content?.characterName || m.name })));
      }
      setPortablePending(pending);
      setBusy(false);
    } catch (e) { setError(portableImportMessage(e)); setBusy(false); }
  }
  interface PortablePendingData {
    name: string; content: DndCharacterData; portrait: string | null; catalog: Catalog; characterUid: string | null;
  }
  const [portablePending, setPortablePending] = useState<PortablePendingData | null>(null);
  const [portableMatches, setPortableMatches] = useState<{ id: number; name: string }[]>([]);
  function cancelPortableImport() { setPortablePending(null); setPortableMatches([]); }
  // Replace (not merge): the file state supersedes the local record wholesale.
  async function applyPortableUpdate() {
    if (!portablePending || portableMatches.length !== 1) return;
    setBusy(true); setError('');
    try {
      const updated = await updatePortableCharacter({
        id: portableMatches[0].id, name: portablePending.name,
        content: portablePending.content, portrait: portablePending.portrait, catalog: portablePending.catalog,
      });
      setPortablePending(null); setPortableMatches([]);
      location.assign(`/?character=${updated.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  // A copy becomes an independent logical character with a fresh UID so the
  // next import no longer confuses it with the original.
  async function copyPortableImport() {
    if (!portablePending) return;
    setBusy(true); setError('');
    try {
      const c = await importPortableRecord({
        catalog: portablePending.catalog, name: portablePending.name,
        content: portablePending.content, portrait: portablePending.portrait, characterUid: null,
      });
      setPortablePending(null); setPortableMatches([]);
      location.assign(`/?character=${c.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  // Local library lifecycle. All ops are local-first (offline-safe); conflicts
  // surface the existing CAS error and ask for a retry — no sync layer.
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [fanSignal, setFanSignal] = useState(0);
  const [gesturesOpen, setGesturesOpen] = useState(false);
  const dndPrefs = useDndPrefs();
  // Главная по макету (гриллинг 2026-09-24): архив — вкладка, экспорт — из
  // меню карты; gmFor/exportingFor привязывают общий экспорт к своей карте.
  const [libTab, setLibTab] = useState<'active' | 'archive'>('active');
  const [gmFor, setGmFor] = useState<number | null>(null);
  const [exportingFor, setExportingFor] = useState<string | null>(null);
  const catalogMedia = useCatalogMedia(characters);
  useEffect(() => {
    if (openMenu === null) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as Element).closest('.lib-menu, .lib-dots')) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('click', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenu]);
  const sheetOpen = !!active?.content;
  // Уход с листа до сохранения теряет правку: и логотип, и «На главную» в
  // меню спрашивают одно и то же.
  const canLeaveSheet = () => {
    if (status === 'Сохранено на устройстве' || !active?.content) return true;
    setError('Дождитесь сохранения или скачайте резервную копию перед выходом.');
    return false;
  };
  useEffect(() => {
    if (sheetOpen && !gesturesSeen() && matchMedia('(max-width: 700px)').matches) setGesturesOpen(true);
  }, [sheetOpen]);
  useEffect(() => {
    if (!headerMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as Element).closest('.oneshot-header-options, .oneshot-header-toggle')) setHeaderMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHeaderMenuOpen(false);
    };
    document.addEventListener('click', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [headerMenuOpen]);
  const modalReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Character | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  async function refreshCharacters() { setCharacters(await listCharacters()); }
  function leaveIfOpen(id: number) {
    if (activeRef.current?.id === id) location.assign('/');
  }
  async function archive(id: number) {
    setLibraryBusy(true); setError('');
    try {
      await archiveCharacter(id);
      setOpenMenu(null);
      await refreshCharacters();
      leaveIfOpen(id);
    } catch (e) { setError((e as Error).message); }
    finally { setLibraryBusy(false); }
  }
  async function restore(id: number) {
    setLibraryBusy(true); setError('');
    try {
      await restoreCharacter(id);
      setOpenMenu(null);
      await refreshCharacters();
    } catch (e) { setError((e as Error).message); }
    finally { setLibraryBusy(false); }
  }
  async function duplicate(id: number) {
    setLibraryBusy(true); setError('');
    try {
      const c = await duplicateCharacter(id);
      setOpenMenu(null);
      await refreshCharacters();
      location.assign(`/?character=${c.id}`);
    } catch (e) { setError((e as Error).message); setLibraryBusy(false); }
  }
  async function confirmDelete() {
    const target = deleteTarget; if (!target) return;
    setLibraryBusy(true); setError('');
    try {
      await deleteCharacter(target.id);
      // Best-effort share revoke: the published snapshot must not outlive
      // the character when the token is known here. Sync/tombstones are
      // untouched; a sibling-device share stays to its own lifecycle.
      if (target.characterUid && syncCred) {
        const token = (await getShareTokens().catch((): Record<string, string> => ({})))[target.characterUid] ?? null;
        if (token) {
          await revokeShare(syncCred.apiBase, syncCred, target.characterUid).catch(() => {});
          await dropShareToken(target.characterUid).catch(() => {});
        }
      }
      // Only this character's own wizard draft keys — never anyone else's.
      // Creation draft (C1) plus the level-up draft (C2).
      try { localStorage.removeItem(wizardDraftKey(target.id)); } catch { /* private mode */ }
      clearLevelUpDraft(target.id);
      setDeleteTarget(null); setOpenMenu(null);
      await refreshCharacters();
      collectGarbage();
      leaveIfOpen(target.id);
    } catch (e) { setError((e as Error).message); }
    finally { setLibraryBusy(false); }
  }
  function libraryCard(c: Character, archived: boolean) {
    const keepFocus = (e: { currentTarget: Element }) => { modalReturnFocusRef.current = e.currentTarget.closest('.lib-card')?.querySelector<HTMLButtonElement>('.lib-dots') ?? null; };
    const busyExport = (kind: string) => exportingFor === `${c.id}:${kind}`;
    const remove = <button role="menuitem" className="is-danger" disabled={libraryBusy} onClick={e => { keepFocus(e); setDeleteTarget(c); setOpenMenu(null); }}>Удалить…</button>;
    const menu = archived ? <>
      <button role="menuitem" disabled={libraryBusy} onClick={() => void restore(c.id)}>Вернуть из архива</button>
      {remove}
    </> : c.content ? <>
      <a role="menuitem" href={`/?character=${c.id}`}>Открыть</a>
      {gmFile && gmFor === c.id
        ? <button role="menuitem" onClick={() => void shareGmFile(gmFile).catch(e => setError((e as Error).message))}>Файл готов — отправить Мастеру</button>
        : <button role="menuitem" disabled={exporting} onClick={() => void exportHtml(true, c)}>{busyExport('gm') ? 'Собираем…' : 'Отправить Мастеру'}</button>}
      <button role="menuitem" disabled={exporting} onClick={() => void exportHtml(false, c).then(() => setOpenMenu(null))}>{busyExport('html') ? 'Собираем…' : 'Скачать автономный HTML'}</button>
      {canDuplicate(c) && <button role="menuitem" disabled={libraryBusy} onClick={() => void duplicate(c.id)}>Создать копию</button>}
      <button role="menuitem" disabled={libraryBusy} onClick={() => void archive(c.id)}>В архив</button>
      {syncCred && c.characterUid && <button role="menuitem" onClick={e => { keepFocus(e); setOpenMenu(null); void openShare(c); }}>Поделиться с мастером</button>}
      {remove}
    </> : <>
      <a role="menuitem" href={`/?character=${c.id}`}>Продолжить создание</a>
      <button role="menuitem" disabled={libraryBusy} onClick={() => void archive(c.id)}>В архив</button>
      {remove}
    </>;
    return <LibraryCard key={c.id} character={c} media={catalogMedia} archived={archived} menuOpen={openMenu === c.id} onMenu={() => setOpenMenu(openMenu === c.id ? null : c.id)} menu={menu} />;
  }
  const visibleCharacters = activeCharacters(characters);
  const archivedList = archivedCharacters(characters);
  return <DndRuntimeContext.Provider value={{ allowDiceRolls: false, campaignConnected: false }}>
    <header className="oneshot-header">
      <a href="/" onClick={e => { if (!canLeaveSheet()) e.preventDefault(); }}>SoyMan_1shot</a>
      {active && <span className="muted oneshot-header-name">{active.name}</span>}
      <span role="status" className={!status && !active ? 'oneshot-header-note' : undefined}>{/* «на устройстве» — одной строкой, как на макете. */}{(status || (active ? '' : 'Всё хранится в этом браузере')).replace(' на ', ' на ')}</span>
      {active?.content && <>
        <button type="button" className="oneshot-header-toggle" aria-label="Дополнительные действия" aria-expanded={headerMenuOpen} aria-controls="oneshot-header-options" onClick={() => setHeaderMenuOpen(v => !v)}>⋯</button>
        <div id="oneshot-header-options" className="oneshot-header-options" data-open={headerMenuOpen}>
          {/* Навигация — для тех, кто не знает свайпов и двойного тапа. */}
          <button className="oneshot-menu-deck" onClick={() => { setHeaderMenuOpen(false); setFanSignal(n => n + 1); }}>Колода карт</button>
          <button className="oneshot-menu-home" onClick={() => { if (canLeaveSheet()) location.assign('/'); }}>На главную</button>
          <span className="oneshot-menu-section">Вид</span>
          <label className="oneshot-large-cards"><input type="checkbox" checked={dndPrefs.abilityPrimary === 'mod'} onChange={e => saveDndPrefs({ ...dndPrefs, abilityPrimary: e.target.checked ? 'mod' : 'score' })} /> На кости — модификатор</label>
          <label className="oneshot-large-cards"><input type="checkbox" checked={includeLargeCards} onChange={e => setIncludeLargeCards(e.target.checked)} /> Большие карты в копии</label>
          <span className="oneshot-menu-section">Файлы</span>
          {gmFile ? <button onClick={() => void shareGmFile(gmFile).catch(e => setError((e as Error).message))}>Файл готов — отправить Мастеру</button> : <button disabled={exporting} onClick={() => void exportHtml(true)}>Отправить Мастеру</button>}
          <button disabled={exporting} onClick={() => void exportHtml()}>{exporting ? 'Собираем автономную копию…' : 'Скачать автономный HTML'}</button>
          <button onClick={() => void backup()}>Скачать резервную копию</button>
          <button onClick={() => void inspectExport()}>Проверить состав</button>
          <button className="oneshot-menu-gestures" onClick={() => { setHeaderMenuOpen(false); setGesturesOpen(true); }}>Показать жесты</button>
        </div>
      </>}
    </header>
    {gesturesOpen && active?.content && <SheetGestures onClose={() => { markGesturesSeen(); setGesturesOpen(false); }} />}
    {exportAudit && <Modal className="oneshot-modal" ariaLabel="Проверка автономной копии" onClose={() => setExportAudit(null)}>
      <h3>Подготовка автономной копии</h3>
      <p>Найдено {exportAudit.entryCount} связанных с персонажем записей из {exportAudit.totalEntryCount} в справочнике. Остальные заклинания и предметы в этот предварительный срез не включены.</p>
      {exportAudit.problems.length > 0 ? <><strong>Нужно дополнить данные</strong><ul>{exportAudit.problems.map(p => <li key={p}>{p}</li>)}</ul></> : <p>Прямые ссылки персонажа найдены в справочнике.</p>}
      {exportAudit.externalAssets.length > 0 && <p>Есть изображения вне пакета: {exportAudit.externalAssets.length}. Их ещё нужно включить в автономную копию.</p>}
      <p className="muted">HTML содержит интерфейс, портрет и выбранные записи справочника вместе с общими игровыми правилами. Спутники по умениям и заклинаниям поддержаны; отдельные статблоки бестиария и внешние изображения пока не переносятся. Полнота особых классовых механик ещё проверяется.</p>
      <Button onClick={() => setExportAudit(null)}>Вернуться к чарнику</Button>
    </Modal>}
    {updateAvailable && <div className="oneshot-update" role="status"><span>Доступна новая версия SoyMan</span><button className="primary" disabled={updateApplying} onClick={() => void applyAppUpdate()}>{updateApplying ? 'Сохраняем…' : 'Обновить'}</button><button disabled={updateApplying} onClick={() => { dismissedUpdateRef.current = true; setUpdateAvailable(false); }}>Позже</button></div>}
    {portablePending && <Modal className="oneshot-modal" ariaLabel="Импорт персонажа" onClose={cancelPortableImport}>
      {portableMatches.length === 1 ? <>
        <h3>Найден существующий персонаж «{portableMatches[0].name}»</h3>
        <p>Файл может содержать более новое игровое состояние.</p>
        <p className="muted">Данные из файла заменят текущее состояние этого персонажа: хиты, ресурсы, заклинания, заметки и остальные данные листа.</p>
        <ActionRow><Button variant="primary" disabled={busy} onClick={() => void applyPortableUpdate()}>{busy ? 'Обновляем…' : 'Обновить существующего'}</Button><Button disabled={busy} onClick={() => void copyPortableImport()}>Создать копию</Button><Button disabled={busy} onClick={cancelPortableImport}>Отмена</Button></ActionRow>
      </> : <>
        <h3>Конфликт identity персонажа</h3>
        <p>Несколько локальных персонажей имеют ту же identity, поэтому обновить одного из них автоматически нельзя.</p>
        <p className="muted">Можно создать независимую копию с новой identity.</p>
        <ActionRow><Button variant="primary" disabled={busy} onClick={() => void copyPortableImport()}>Создать копию</Button><Button disabled={busy} onClick={cancelPortableImport}>Отмена</Button></ActionRow>
      </>}
    </Modal>}
    {deleteTarget && <Modal className="oneshot-modal oneshot-modal-danger" ariaLabel={`Удалить ${displayName(deleteTarget)}?`} returnFocusTo={modalReturnFocusRef} onClose={() => { if (!libraryBusy) setDeleteTarget(null); }}>
      <h3>Удалить «{displayName(deleteTarget)}»?</h3>
      <p>Персонаж будет удалён с этого устройства. Это действие нельзя отменить.</p>
      <ActionRow><Button variant="danger" disabled={libraryBusy} onClick={() => void confirmDelete()}>{libraryBusy ? 'Удаляем…' : 'Удалить'}</Button><Button disabled={libraryBusy} onClick={() => setDeleteTarget(null)}>Отмена</Button></ActionRow>
    </Modal>}
    {pairing && <Modal className="oneshot-modal" ariaLabel="Подключение другого устройства" onClose={() => { if (!syncBusy) setPairing(null); }}>
      <h3>Подключить другое устройство</h3>
      <p className="muted">На новом устройстве откройте код камерой или вставьте ссылку. Ссылка одноразовая, действует около 10 минут.</p>
      <p><QRCodeSVG value={pairing.link} size={220} /></p>
      <p><Button disabled={syncBusy} onClick={() => void copyPairingLink()}>Скопировать ссылку</Button></p>
      <ActionRow><Button disabled={syncBusy} onClick={() => setPairing(null)}>Готово</Button></ActionRow>
    </Modal>}
    {incomingPair && <Modal className="oneshot-modal" ariaLabel="Подключение синхронизации" onClose={() => { if (!syncBusy) declinePairing(); }}>
      <h3>Подключить это устройство к синхронизации SoyMan?</h3>
      <p className="muted">Устройство получит собственный доступ к вашему пространству. Персонажи пока никуда не отправляются.</p>
      <ActionRow><Button variant="primary" disabled={syncBusy} onClick={() => void acceptPairing()}>{syncBusy ? 'Подключаем…' : 'Подключить'}</Button><Button disabled={syncBusy} onClick={declinePairing}>Отмена</Button></ActionRow>
    </Modal>}
    {confirmUnlink && <Modal className="oneshot-modal" ariaLabel="Отключение синхронизации" onClose={() => { if (!syncBusy) setConfirmUnlink(false); }}>
      <h3>Отключить это устройство?</h3>
      <p>Локальные персонажи останутся на месте. Синхронизация просто перестанет работать на этом устройстве.</p>
      <ActionRow><Button variant="danger" disabled={syncBusy} onClick={() => void disconnectSync()}>{syncBusy ? 'Отключаем…' : 'Отключить'}</Button><Button disabled={syncBusy} onClick={() => setConfirmUnlink(false)}>Отмена</Button></ActionRow>
    </Modal>}
    {syncConflicts && <Modal className="oneshot-modal" ariaLabel="Конфликты синхронизации" onClose={() => { if (resolvingUid === null) setSyncConflicts(null); }}>
      <h3>Конфликты синхронизации</h3>
      <p className="muted">Обе версии персонажа изменились после последней синхронизации.</p>
      {syncConflicts.map((conflict) => <section key={conflict.uid} aria-label={`Конфликт: ${conflict.name}`}>
        <h2>{conflict.kind === 'local-deleted-remote-changed'
          ? `Персонаж «${conflict.name}» удалён на этом устройстве, но был изменён на другом.`
          : conflict.kind === 'remote-deleted-local-changed' || conflict.kind === 'remote-deleted-unmatched'
            ? `Персонаж «${conflict.name}» удалён на другом устройстве, но здесь есть несинхронизированные изменения.`
            : `Персонаж «${conflict.name}» изменился и здесь, и на другом устройстве.`}</h2>
        <ActionRow>
          {conflict.kind === 'local-deleted-remote-changed'
            ? <Button variant="danger" disabled={resolvingUid !== null} onClick={() => void resolveConflictKeepLocal(conflict.uid)}>{resolvingUid === conflict.uid ? 'Удаляем…' : 'Удалить везде'}</Button>
            : <Button variant="primary" disabled={resolvingUid !== null} onClick={() => void resolveConflictKeepLocal(conflict.uid)}>{resolvingUid === conflict.uid ? 'Сохраняем…' : 'Оставить версию этого устройства'}</Button>}
          {conflict.remoteDeleted
            ? <Button variant="danger" disabled={resolvingUid !== null} onClick={() => void resolveConflictUseServer(conflict.uid)}>{resolvingUid === conflict.uid ? 'Удаляем…' : 'Удалить и здесь'}</Button>
            : <Button disabled={resolvingUid !== null} onClick={() => void resolveConflictUseServer(conflict.uid)}>{resolvingUid === conflict.uid ? 'Загружаем…' : 'Использовать версию с сервера'}</Button>}
        </ActionRow>
      </section>)}
      <ActionRow><Button disabled={resolvingUid !== null} onClick={() => setSyncConflicts(null)}>Отмена</Button></ActionRow>
    </Modal>}
    {shareTarget && <Modal className="oneshot-modal" ariaLabel="Публикация персонажа для мастера" returnFocusTo={modalReturnFocusRef} onClose={() => { if (!shareBusy) setShareTarget(null); }}>
      <h3>Поделиться с мастером — «{shareTarget.name}»</h3>
      {(() => {
        const conflicted = [...(syncConflicts ?? []), ...(autoConflictNotice ?? [])].some((c) => c.uid === shareTarget.uid);
        return (<>
          {shareToken ? <>
            <p className="muted">Ссылка создана{shareUpdatedAt ? ` · обновлена ${new Date(shareUpdatedAt).toLocaleString('ru-RU')}` : ''}.</p>
            <p><a href={shareLink() ?? undefined} target="_blank" rel="noreferrer">{shareLink()}</a></p>
            <ActionRow>
              <Button variant="primary" disabled={shareBusy} onClick={() => void copyShareLink()}>Скопировать ссылку</Button>
              <a role="button" href={shareLink() ?? undefined} target="_blank" rel="noreferrer">Открыть</a>
              <Button disabled={shareBusy} onClick={() => void refreshShare()}>{shareBusy ? 'Обновляем…' : 'Обновить опубликованную версию'}</Button>
              <Button variant="danger" disabled={shareBusy} onClick={() => void unshare()}>Отключить ссылку</Button>
            </ActionRow>
          </> : shareServerActive ? <>
            <p className="muted">Ссылка активна, но создана на другом устройстве — скопировать её отсюда нельзя.</p>
            <ActionRow>
              <Button disabled={shareBusy} onClick={() => void refreshShare()}>{shareBusy ? 'Обновляем…' : 'Обновить опубликованную версию'}</Button>
              <Button variant="danger" disabled={shareBusy} onClick={() => void unshare()}>Отключить ссылку</Button>
            </ActionRow>
          </> : <>
            <p className="muted">Любой, у кого есть эта ссылка, сможет просматривать опубликованную версию персонажа.</p>
            <ActionRow>
              <Button variant="primary" disabled={shareBusy} onClick={() => void publishShare()}>{shareBusy ? 'Публикуем…' : 'Создать ссылку'}</Button>
            </ActionRow>
          </>}
          {conflicted && <p className="muted">Есть нерешённый конфликт синхронизации — публикуется версия, которую вы видите сейчас.</p>}
          {shareError !== '' && <Banner as="p">{shareError}</Banner>}
          <ActionRow><Button disabled={shareBusy} onClick={() => setShareTarget(null)}>Закрыть</Button></ActionRow>
        </>);
      })()}
    </Modal>}
    {error && <Banner>{error}</Banner>}
    {!ready ? <p className="oneshot-home">Открываем локальные данные…</p> : active?.content ? <div className="oneshot-sheet"><div className="fp-page-backdrop" aria-hidden="true" /><DndCharacterView key={active.id} value={active.content} portraitUrl={active.portrait} onQuickUpdate={update} onLevelUpApply={applyLevelUp} syncTabToUrl onPortraitUpload={uploadPortrait} levelUpDraft={{ identity: { characterId: active.id, characterUid: active.characterUid ?? null, catalogKey: active.catalogKey }, initial: loadLevelUpDraft(active.id), onChange: saveLevelUpDraft, onClear: () => clearLevelUpDraft(active.id) }} onSheetBack={() => { if (status === 'Сохранено на устройстве') location.assign('/'); }} fanSignal={fanSignal} /></div> : <main className="oneshot-home lib">
      <div className="lib-top"><div className="lib-head">
        <p className="lib-kicker">Библиотека</p>
        <h1 className="lib-title">Твои персонажи</h1>
      </div>
      <div className="lib-seg" role="group" aria-label="Состав библиотеки">
        <button type="button" aria-pressed={libTab === 'active'} onClick={() => setLibTab('active')}>Активные <b>{visibleCharacters.length}</b></button>
        <button type="button" aria-pressed={libTab === 'archive'} onClick={() => setLibTab('archive')}>Архив <b>{archivedList.length}</b></button>
      </div></div>
      {libTab === 'active' && <div className="lib-new-wrap"><section className="lib-new" aria-label="Новый персонаж">
        <h2 className="lib-new-title">Новый персонаж</h2>
        <label className="lib-name"><span>Имя</span><input value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="Как зовут героя?" /></label>
        <span className="lib-primary-shadow"><button type="button" className="lib-primary" disabled={busy} onClick={() => void create()}>Создать через визард<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg></button></span>
        <button type="button" className="lib-blank" disabled={busy} onClick={() => void create(true)}>или открыть пустой лист</button>
        {managed === 'working' && !catalogKey && <p className="muted">Подготавливаем игровые данные…</p>}{managed === 'failed' && !catalogKey && <p className="muted">Для первого создания персонажа нужно один раз загрузить игровые данные. <button onClick={retryManaged}>Повторить</button></p>}{media === 'working' && <p className="muted">Загружаем изображения…</p>}
      </section></div>}
      <div className="lib-cards">
        {(libTab === 'active' ? visibleCharacters : archivedList).map(c => libraryCard(c, libTab === 'archive'))}
        {libTab === 'active' && !visibleCharacters.length && <div className="lib-empty">Здесь появятся твои персонажи</div>}
        {libTab === 'archive' && !archivedList.length && <p className="lib-empty-note">Архив пуст.</p>}
      </div>
      <footer className="lib-foot">
        <button type="button" className="lib-btn" onClick={() => restoreFile.current?.click()}>Восстановить из копии</button>
        <button type="button" className="lib-btn" disabled={busy} onClick={() => portableFile.current?.click()}>Импортировать персонажа</button>
        <p className="lib-note">Автономный HTML и «Отправить Мастеру» — в меню «⋯» у карты и в открытом листе.</p>
        <input ref={portableFile} hidden type="file" accept=".html,text/html" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importPortableFile(file); }} /><input ref={restoreFile} hidden type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const data = await readFile(file); if (data.format !== 'soyman-1shot-backup' || data.version !== 1) throw Error('Нужна резервная копия OneShot'); const content = parseCharacterContent(data.character?.content); const key = data.catalog ? await saveCatalog(parseCatalog(data.catalog)) : null; const c = await createCharacter(content.characterName || 'Восстановленный персонаж', key); const portrait = typeof data.character?.portrait === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data.character.portrait) ? data.character.portrait : null; await saveCharacter({ ...c, content, portrait, characterUid: isCharacterUid(data.character?.characterUid) ? data.character.characterUid : c.characterUid }); location.assign(`/?character=${c.id}`); } catch (err) { setError((err as Error).message); } e.target.value = ''; }} />
      <details className="lib-tools"><summary>Инструменты и данные</summary>
        {diag && <p className="muted">Игровые данные{diag.version ? `: версия ${diag.version}` : ''} · установлено версий: {diag.count}</p>}
        <p><button onClick={() => importFile.current?.click()}>Импортировать справочник вручную</button><input hidden ref={importFile} type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { await saveCatalog(parseCatalog(await readFile(file))); location.reload(); } catch (err) { setError((err as Error).message); } e.target.value = ''; }} /></p>
        {import.meta.env.DEV && <p><button onClick={async () => { try { const response = await fetch('/__local/catalog'); if (!response.ok) throw Error('Локальная копия справочника ещё не подготовлена'); await saveCatalog(parseCatalog(await response.json())); location.reload(); } catch (e) { setError((e as Error).message); } }}>Подключить локальный справочник SoyMan</button></p>}
        {serverCatalog && <section><h2>Общий справочник сайта</h2><p>Подключите готовый справочник для создания персонажей. Загрузка может занять некоторое время. Уже созданные персонажи сохранят свою версию правил.</p><button disabled={busy} onClick={() => void connectServerCatalog()}>{busy ? 'Загружаем справочник…' : 'Подключить общий справочник'}</button></section>}
        <section aria-label="Локальные данные"><h2>Локальные данные</h2><p className="muted">{storageProtectionText(storageStatus)}</p>{storageStatus.usageText && <p className="muted">{storageStatus.usageText}</p>}{storageStatus.supported && storageStatus.persisted === false && <p><button disabled={persistBusy} onClick={() => void protectData()}>{persistBusy ? 'Запрашиваем…' : 'Защитить данные'}</button></p>}{shouldAdviseBackup({ supported: storageStatus.supported, persisted: storageStatus.persisted, hasCharacters: characters.length > 0 }) && <p className="muted">Рекомендуется сохранить резервную копию персонажей.</p>}</section>
        {syncAllowed && <section aria-label="Синхронизация"><h2>Синхронизация между устройствами</h2>
          {!syncCred ? <>
            <p className="muted">Синхронизация не включена. Пока только подключение устройств; персонажи не отправляются.</p>
            <p><label>Адрес сервера SoyMan <input value={syncServerInput} onChange={e => setSyncServerInput(e.target.value)} maxLength={200} placeholder="http://192.168.1.5:3001" inputMode="url" /></label></p>
            <p><button disabled={syncBusy} onClick={() => void enableSync()}>{syncBusy ? 'Включаем…' : 'Включить синхронизацию'}</button></p>
          </> : <>
            <p className="muted">Синхронизация подключена. Это устройство связано с вашим пространством SoyMan.</p>
            {!syncOnline && <p className="muted">Синхронизация временно недоступна.</p>}
            <p className="muted">При синхронизации копии персонажей хранятся на выбранном сервере SoyMan.</p>
            <p><label><input type="checkbox" checked={autoEnabled} onChange={(e) => void toggleAutoSync(e.target.checked)} /> Автоматически синхронизировать изменения</label></p>
            <p className="muted">Изменения персонажей будут автоматически отправляться на выбранный сервер SoyMan.</p>
            <ActionRow><Button disabled={syncing || syncBusy} onClick={() => void syncNow()}>{syncing ? 'Синхронизируем…' : 'Синхронизировать сейчас'}</Button><Button disabled={syncing || syncBusy} onClick={() => void showPairing()}>{syncBusy ? 'Готовим…' : 'Подключить другое устройство'}</Button><Button variant="danger" disabled={syncing || syncBusy} onClick={() => setConfirmUnlink(true)}>Отключить это устройство</Button></ActionRow>
            {autoSyncing && <p className="muted">Синхронизация…</p>}
            {!autoSyncing && autoStatus !== '' && <p className="muted">{autoStatus}</p>}
            {autoConflictNotice && !syncConflicts && <p className="muted">Есть конфликт синхронизации. <button onClick={() => { setSyncConflicts(autoConflictNotice); setAutoConflictNotice(null); }}>Разрешить</button></p>}
            {syncResult && <p className="muted">Последняя синхронизация: {new Date(syncResult.at).toLocaleString('ru-RU')} · отправлено: {syncResult.pushed}, получено: {syncResult.pulled}, конфликтов: {syncResult.conflicts}{syncResult.sentBytes > 0 && ` · отправлено данных: ~${Math.max(1, Math.round(syncResult.sentBytes / 1024))} КБ`}{syncResult.errors.length > 0 && ` · ошибки: ${syncResult.errors.length}`}</p>}
            {syncResult && syncResult.errors.length > 0 && <ul>{syncResult.errors.slice(0, 3).map((message) => <li key={message} className="muted">{message}</li>)}</ul>}
          </>}
          {syncError && <Banner as="p">{syncError}</Banner>}
        </section>}
      </details>
      </footer>
    </main>}
    {wizard && active && <DndCharacterWizard ownerType="character" ownerId={active.id} ownerName={active.name} initialSystemId={active.catalogKey ? 1 : null} visualVariant="oneshot" onDone={() => location.reload()} onCancel={() => location.assign('/')} />}
    <SaveNotices />
  </DndRuntimeContext.Provider>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
// PWA update wiring lives in the <App/> effect above (registration, waiting-SW
// banner, controllerchange reload guard). Kept out of module scope so
// listeners dispose with the root and never double-register under HMR.

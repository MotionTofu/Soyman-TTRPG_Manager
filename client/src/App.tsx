import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { LoginGate } from "./components/LoginGate";
import { RealtimeListener } from "./RealtimeListener";
import { CrossWindowSyncBanner } from "./components/CrossWindowSyncBanner";
import { useCurrentUser } from "./api/currentUser";

// Every route below is its own chunk (Vite code-splits on dynamic import)
// instead of one large bundle — mainly matters for the hosted web/server
// deployment's first load; the local Electron app loads from disk either
// way. Each page is a named export, so the lazy() factory re-shapes it to
// the { default } shape React.lazy expects.
const HomeCalendarPage = lazy(() => import("./pages/HomeCalendarPage").then((m) => ({ default: m.HomeCalendarPage })));
const PlayerHomePage = lazy(() => import("./pages/PlayerHomePage").then((m) => ({ default: m.PlayerHomePage })));
const CampaignsListPage = lazy(() => import("./pages/CampaignsListPage").then((m) => ({ default: m.CampaignsListPage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const PlayerLibraryPage = lazy(() =>
  import("./pages/PlayerLibraryPage").then((m) => ({ default: m.PlayerLibraryPage }))
);
const NowPlayingPage = lazy(() => import("./pages/NowPlayingPage").then((m) => ({ default: m.NowPlayingPage })));
const CampaignDetailPage = lazy(() => import("./pages/CampaignDetailPage").then((m) => ({ default: m.CampaignDetailPage })));
const SessionDetailPage = lazy(() => import("./pages/SessionDetailPage").then((m) => ({ default: m.SessionDetailPage })));
const SessionLivePage = lazy(() => import("./pages/SessionLivePage").then((m) => ({ default: m.SessionLivePage })));
const SoundConsolePage = lazy(() =>
  import("./pages/SoundConsolePage").then((m) => ({ default: m.SoundConsolePage }))
);
const SessionPanelPopoutPage = lazy(() =>
  import("./pages/SessionPanelPopoutPage").then((m) => ({ default: m.SessionPanelPopoutPage }))
);
const PlayersListPage = lazy(() => import("./pages/PlayersListPage").then((m) => ({ default: m.PlayersListPage })));
const PlayerDetailPage = lazy(() => import("./pages/PlayerDetailPage").then((m) => ({ default: m.PlayerDetailPage })));
const SettingsListPage = lazy(() => import("./pages/SettingsListPage").then((m) => ({ default: m.SettingsListPage })));
const SettingDetailPage = lazy(() => import("./pages/SettingDetailPage").then((m) => ({ default: m.SettingDetailPage })));
const SystemsListPage = lazy(() => import("./pages/SystemsListPage").then((m) => ({ default: m.SystemsListPage })));
const SystemDetailPage = lazy(() => import("./pages/SystemDetailPage").then((m) => ({ default: m.SystemDetailPage })));
const ResourcesListPage = lazy(() => import("./pages/ResourcesListPage").then((m) => ({ default: m.ResourcesListPage })));
const MasteringPage = lazy(() => import("./pages/MasteringPage").then((m) => ({ default: m.MasteringPage })));
const CharacterDetailPage = lazy(() => import("./pages/CharacterDetailPage").then((m) => ({ default: m.CharacterDetailPage })));
const ArchivePage = lazy(() => import("./pages/ArchivePage").then((m) => ({ default: m.ArchivePage })));
const LocationDetailPage = lazy(() => import("./pages/LocationDetailPage").then((m) => ({ default: m.LocationDetailPage })));
const BeingDetailPage = lazy(() => import("./pages/BeingDetailPage").then((m) => ({ default: m.BeingDetailPage })));
const AdventureDetailPage = lazy(() => import("./pages/AdventureDetailPage").then((m) => ({ default: m.AdventureDetailPage })));
const ImportAdventurePage = lazy(() => import("./pages/ImportAdventurePage").then((m) => ({ default: m.ImportAdventurePage })));
const ImportSystemPage = lazy(() => import("./pages/ImportSystemPage").then((m) => ({ default: m.ImportSystemPage })));
const SceneDetailPage = lazy(() => import("./pages/SceneDetailPage").then((m) => ({ default: m.SceneDetailPage })));
const ArtifactDetailPage = lazy(() => import("./pages/ArtifactDetailPage").then((m) => ({ default: m.ArtifactDetailPage })));
const CommunityDetailPage = lazy(() => import("./pages/CommunityDetailPage").then((m) => ({ default: m.CommunityDetailPage })));
const EventDetailPage = lazy(() => import("./pages/EventDetailPage").then((m) => ({ default: m.EventDetailPage })));
const CompendiumEntryRedirectPage = lazy(() =>
  import("./pages/CompendiumEntryRedirectPage").then((m) => ({ default: m.CompendiumEntryRedirectPage }))
);
const GraphPage = lazy(() => import("./pages/GraphPage").then((m) => ({ default: m.GraphPage })));
// Полотно тянет за собой @xyflow/react — единственную тяжёлую внешнюю
// зависимость клиента, и грузить её тем, кто на холст не заходит, незачем.
const CanvasPage = lazy(() => import("./pages/CanvasPage").then((m) => ({ default: m.CanvasPage })));
const StoragesSettingsPage = lazy(() => import("./pages/StoragesSettingsPage").then((m) => ({ default: m.StoragesSettingsPage })));
const AppearanceSettingsPage = lazy(() =>
  import("./pages/AppearanceSettingsPage").then((m) => ({ default: m.AppearanceSettingsPage }))
);
const AboutPage = lazy(() => import("./pages/AboutPage").then((m) => ({ default: m.AboutPage })));
const InvitationsPage = lazy(() => import("./pages/InvitationsPage").then((m) => ({ default: m.InvitationsPage })));
const PlayerCabinetPage = lazy(() =>
  import("./pages/PlayerCabinetPage").then((m) => ({ default: m.PlayerCabinetPage }))
);
const PlayerCampaignsListPage = lazy(() =>
  import("./pages/PlayerCampaignsListPage").then((m) => ({ default: m.PlayerCampaignsListPage }))
);
const PlayerCampaignPage = lazy(() => import("./pages/PlayerCampaignPage").then((m) => ({ default: m.PlayerCampaignPage })));
const PlayerSettingsListPage = lazy(() =>
  import("./pages/PlayerSettingsListPage").then((m) => ({ default: m.PlayerSettingsListPage }))
);
const PlayerSettingPage = lazy(() => import("./pages/PlayerSettingPage").then((m) => ({ default: m.PlayerSettingPage })));

// GM tokens see the full CampaignsListPage/CampaignDetailPage (unfiltered
// admin data); player tokens get the read-only "what the GM revealed"
// equivalent instead — /api/campaigns/** is 403 for them (see
// services/playerAccess.ts), so rendering the GM page would just show empty
// error states.
function HomeRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  return user?.role === "player" ? <PlayerHomePage /> : <HomeCalendarPage />;
}
function CampaignsRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  return user?.role === "player" ? <PlayerCampaignsListPage /> : <CampaignsListPage />;
}
function CampaignDetailRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  return user?.role === "player" ? <PlayerCampaignPage /> : <CampaignDetailPage />;
}
function SettingsRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  return user?.role === "player" ? <PlayerSettingsListPage /> : <SettingsListPage />;
}
// Импорт книги приключений — инструмент мастера: игроку тут делать нечего.
function ImportRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  return user?.role === "player" ? <Navigate to="/" replace /> : <ImportAdventurePage />;
}
// Импорт книги правил — тоже мастерский инструмент: он правит компендиум системы.
function ImportSystemRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  return user?.role === "player" ? <Navigate to="/" replace /> : <ImportSystemPage />;
}
function SettingDetailRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  return user?.role === "player" ? <PlayerSettingPage /> : <SettingDetailPage />;
}
function LibraryRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  return user?.role === "player" ? <PlayerLibraryPage /> : <LibraryPage />;
}

function App() {
  return (
    <BrowserRouter>
      <LoginGate>
        <RealtimeListener />
        <CrossWindowSyncBanner />
        <Suspense fallback={<p className="muted" style={{ padding: 24 }}>Загрузка…</p>}>
          <Routes>
            {/* Outside <AppShell> on purpose — a popped-out panel window
                (see sessionLivePanels.tsx) has no room to spare for the
                sidebar/search/audio-bar chrome that wraps every other route. */}
            <Route path="/sessions/:id/live/panel/:panelKey" element={<SessionPanelPopoutPage />} />
            {/* Пульт звука — тоже вне <AppShell>: отдельное окно на второй
                монитор, где сайдбар и нижняя панель только отняли бы место.
                Своего звука у него нет — движок живёт в главном окне, см.
                sound/engine.tsx. */}
            <Route path="/sound-console" element={<SoundConsolePage />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/library" element={<LibraryRoute />} />
              <Route path="/now-playing" element={<NowPlayingPage />} />
              <Route path="/campaigns" element={<CampaignsRoute />} />
              <Route path="/campaigns/:id" element={<CampaignDetailRoute />} />
              <Route path="/sessions/:id" element={<SessionDetailPage />} />
              <Route path="/sessions/:id/live" element={<SessionLivePage />} />
              <Route path="/players" element={<PlayersListPage />} />
              {/* Ticket 13: player character list moved into Кабинет — redirect the
                  old standalone route for any stale links/bookmarks. */}
              <Route path="/my-characters" element={<Navigate to="/cabinet" replace />} />
              <Route path="/cabinet" element={<PlayerCabinetPage />} />
              <Route path="/players/:id" element={<PlayerDetailPage />} />
              <Route path="/settings" element={<SettingsRoute />} />
              <Route path="/settings/:id" element={<SettingDetailRoute />} />
              <Route path="/import" element={<ImportRoute />} />
              <Route path="/import-system" element={<ImportSystemRoute />} />
              <Route path="/systems" element={<SystemsListPage />} />
              <Route path="/systems/:id" element={<SystemDetailPage />} />
              <Route path="/resources" element={<ResourcesListPage />} />
              <Route path="/mastering" element={<MasteringPage />} />
              <Route path="/characters/:id" element={<CharacterDetailPage />} />
              <Route path="/locations/:id" element={<LocationDetailPage />} />
              <Route path="/beings/:id" element={<BeingDetailPage />} />
              <Route path="/scenes/:id" element={<SceneDetailPage />} />
              <Route path="/adventures/:id" element={<AdventureDetailPage />} />
              <Route path="/artifacts/:id" element={<ArtifactDetailPage />} />
              <Route path="/communities/:id" element={<CommunityDetailPage />} />
              <Route path="/events/:id" element={<EventDetailPage />} />
              <Route path="/compendium/:id" element={<CompendiumEntryRedirectPage />} />
              <Route path="/canvas" element={<CanvasPage />} />
              <Route path="/graph" element={<GraphPage />} />
              <Route path="/storages" element={<StoragesSettingsPage />} />
              <Route path="/appearance" element={<AppearanceSettingsPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/invitations" element={<InvitationsPage />} />
              <Route path="/archive" element={<ArchivePage />} />
            </Route>
          </Routes>
        </Suspense>
      </LoginGate>
    </BrowserRouter>
  );
}

export default App;

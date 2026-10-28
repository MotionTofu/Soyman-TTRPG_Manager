import type { ReactNode } from "react";
import { useCurrentUser } from "../../api/currentUser";
import { PageFrame } from "../PageFrame";
import { Loading } from "../Loading";
import { EmptyState } from "../EmptyState";

export function CutsceneAccess({ children }: { children: ReactNode }) {
  const { user, loading } = useCurrentUser();
  if (loading) return <Loading />;
  if (user?.role !== "gm") return <PageFrame title="Катсцены"><EmptyState kind="search" title="Только для Мастера" hint="Катсцены и тексты ведущего доступны Мастеру." /></PageFrame>;
  return <>{children}</>;
}

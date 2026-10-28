import { createContext } from "react";

export interface WorkshopValidity {
  read(key: string): string | undefined;
  report(key: string, raw: string, invalid: boolean): void;
  invalid(prefix: string): boolean;
}
export const WorkshopValidityContext = createContext<WorkshopValidity | null>(null);

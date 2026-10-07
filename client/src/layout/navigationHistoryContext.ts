import { createContext, useContext } from "react";

export const NavigationHistory = createContext<(() => void) | null>(null);
export function usePreviousPage() { return useContext(NavigationHistory); }

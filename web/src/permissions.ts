import { createContext, useContext } from "react";
import type { Permission } from "./api.js";

const PermissionsContext = createContext<Set<Permission>>(new Set());

export const PermissionsProvider = PermissionsContext.Provider;

export function usePermissions() {
  const permissions = useContext(PermissionsContext);
  return { has: (p: Permission) => permissions.has(p) };
}

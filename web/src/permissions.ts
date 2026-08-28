import { createContext, useContext } from "react";
import type { Permission } from "./api.js";

export interface PermissionsValue {
  permissions: Set<Permission>;
  // The signed-in User Roles record id (undefined for a session type that doesn't
  // carry one) — lets a component tell "something this account itself created" apart
  // from anyone else's, e.g. StudentPage.tsx deciding whether to show a note's Edit
  // button.
  userRoleId?: string;
}

const PermissionsContext = createContext<PermissionsValue>({ permissions: new Set() });

export const PermissionsProvider = PermissionsContext.Provider;

export function usePermissions() {
  const { permissions, userRoleId } = useContext(PermissionsContext);
  return { has: (p: Permission) => permissions.has(p), userRoleId };
}

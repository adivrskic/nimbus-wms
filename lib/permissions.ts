import { useMemo } from "react";
import { useWarehouse } from "./warehouse";

/**
 * Granular RBAC — a faithful port of the desktop app's permission model
 * (app-nimbus1 lib/permissions.ts effectivePermissions):
 *
 *   owner                       -> every permission
 *   explicit permissions[] set  -> that set (overrides the role default)
 *   admin, no explicit set      -> every permission
 *   member, no explicit set     -> MEMBER_DEFAULTS
 *
 * The same resolution is enforced server-side by RLS (app.has_any_perm), so
 * these booleans are UX (hide/disable controls) — not the security boundary.
 * MEMBER_DEFAULTS must stay in sync with the desktop file and the
 * rls_permission_gating migration.
 */

export type Permission =
  | "inventory.manage"
  | "inventory.adjust"
  | "cycle_counts.void"
  | "orders.manage"
  | "orders.allocate"
  | "customers.manage"
  | "purchasing.manage"
  | "purchasing.receive"
  | "suppliers.manage"
  | "qc.review"
  | "picking.manage"
  | "work_orders.manage"
  | "facilities.manage"
  | "adjustments.approve"
  | "reports.manage"
  | "settings.manage"
  | "members.manage"
  | "billing.manage"
  | "integrations.manage";

const ALL_PERMISSIONS: Permission[] = [
  "inventory.manage",
  "inventory.adjust",
  "cycle_counts.void",
  "orders.manage",
  "orders.allocate",
  "customers.manage",
  "purchasing.manage",
  "purchasing.receive",
  "suppliers.manage",
  "qc.review",
  "picking.manage",
  "work_orders.manage",
  "facilities.manage",
  "adjustments.approve",
  "reports.manage",
  "settings.manage",
  "members.manage",
  "billing.manage",
  "integrations.manage",
];

const MEMBER_DEFAULTS: Permission[] = [
  "inventory.adjust",
  "orders.manage",
  "orders.allocate",
  "customers.manage",
  "picking.manage",
  "purchasing.receive",
  "suppliers.manage",
  "qc.review",
  "work_orders.manage",
  "reports.manage",
];

const VALID = new Set<string>(ALL_PERMISSIONS);

export function effectivePermissions(
  role: string,
  custom: string[] | null | undefined
): Set<Permission> {
  // Legacy mobile role names map onto the desktop trio for safety.
  const normalized =
    role === "super_admin" ? "owner" : role === "manager" ? "admin" : role;
  if (normalized === "owner") return new Set(ALL_PERMISSIONS);
  if (custom != null) {
    return new Set(custom.filter((p): p is Permission => VALID.has(p)));
  }
  if (normalized === "admin") return new Set(ALL_PERMISSIONS);
  return new Set(MEMBER_DEFAULTS);
}

export type Permissions = {
  role: string;
  can: (p: Permission) => boolean;
  // Lookup / read
  canScanProducts: boolean;
  canViewInventory: boolean;
  canViewReports: boolean;
  // Catalog (inventory.manage)
  canRegisterProducts: boolean;
  canEditProducts: boolean;
  canDeleteProducts: boolean;
  canExportInventory: boolean;
  canViewLabelPrinting: boolean;
  // Stock (inventory.adjust)
  canAdjustQuantity: boolean;
  canRelocateProducts: boolean;
  canRecordCounts: boolean;
  // Flow
  canPickOrders: boolean;
  canManageWaves: boolean;
  canCreatePurchaseOrders: boolean;
  canCancelPurchaseOrders: boolean;
  canReceive: boolean;
  canReviewQC: boolean;
  canProcessReturns: boolean;
  canCompleteWorkOrders: boolean;
  canApproveAdjustments: boolean;
  // Admin
  canCreateWarehouse: boolean;
  canEditWarehouse: boolean;
  canDeleteWarehouse: boolean;
  canManageStaff: boolean;
  canAssignRoles: boolean;
  canPromoteToSuperAdmin: boolean;
  canEditSettings: boolean;
};

export function usePermissions(): Permissions {
  const { userRole, userPermissions } = useWarehouse();
  const role = userRole || "member";

  return useMemo(() => {
    const perms = effectivePermissions(role, userPermissions);
    const can = (p: Permission) => perms.has(p);
    const isOwner = role === "owner" || role === "super_admin";

    return {
      role,
      can,
      canScanProducts: true,
      canViewInventory: true,
      canViewReports: can("reports.manage"),
      canRegisterProducts: can("inventory.manage"),
      canEditProducts: can("inventory.manage"),
      canDeleteProducts: can("inventory.manage"),
      canExportInventory: can("inventory.manage"),
      canViewLabelPrinting: can("inventory.manage"),
      canAdjustQuantity: can("inventory.adjust"),
      canRelocateProducts: can("inventory.adjust"),
      canRecordCounts: can("inventory.adjust"),
      canPickOrders: can("orders.manage") || can("picking.manage"),
      canManageWaves: can("picking.manage"),
      canCreatePurchaseOrders: can("purchasing.manage"),
      canCancelPurchaseOrders: can("purchasing.manage"),
      canReceive: can("purchasing.receive") || can("purchasing.manage"),
      canReviewQC: can("qc.review"),
      canProcessReturns: can("inventory.adjust") || can("orders.manage"),
      canCompleteWorkOrders: can("work_orders.manage"),
      canApproveAdjustments: can("adjustments.approve"),
      canCreateWarehouse: can("facilities.manage"),
      canEditWarehouse: can("facilities.manage"),
      canDeleteWarehouse: can("facilities.manage"),
      canManageStaff: can("members.manage"),
      canAssignRoles: can("members.manage"),
      canPromoteToSuperAdmin: isOwner,
      canEditSettings: can("settings.manage"),
    };
  }, [role, userPermissions]);
}

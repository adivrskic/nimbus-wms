import { useWarehouse } from "./warehouse";

export type Permissions = {
  role: string;
  canScanProducts: boolean;
  canRegisterProducts: boolean;
  canEditProducts: boolean;
  canDeleteProducts: boolean;
  canAdjustQuantity: boolean;
  canRelocateProducts: boolean;
  canViewInventory: boolean;
  canExportInventory: boolean;
  canViewReports: boolean;
  canCreateWarehouse: boolean;
  canEditWarehouse: boolean;
  canDeleteWarehouse: boolean;
  canManageStaff: boolean;
  canAssignRoles: boolean;
  canPromoteToSuperAdmin: boolean;
  canEditSettings: boolean;
  canViewLabelPrinting: boolean;
};

export function usePermissions(): Permissions {
  const { userRole } = useWarehouse();
  const role = userRole || "member";

  // Desktop org roles: owner / admin / member (app.org_members.role).
  // Legacy mobile names (super_admin / manager / staff) still map for safety.
  const isSuperAdmin = role === "owner" || role === "super_admin";
  const isManager = role === "admin" || role === "manager";

  return {
    role,
    // All roles
    canScanProducts: true,
    canRegisterProducts: true,
    canAdjustQuantity: true,
    canRelocateProducts: true,
    canViewInventory: true,
    // Manager and above
    canEditProducts: isSuperAdmin || isManager,
    canDeleteProducts: isSuperAdmin || isManager,
    canExportInventory: isSuperAdmin || isManager,
    canViewReports: isSuperAdmin || isManager,
    canEditWarehouse: isSuperAdmin || isManager,
    canManageStaff: isSuperAdmin || isManager,
    canAssignRoles: isSuperAdmin || isManager,
    canEditSettings: isSuperAdmin || isManager,
    canViewLabelPrinting: isSuperAdmin || isManager,
    // Super admin only
    canCreateWarehouse: isSuperAdmin,
    canDeleteWarehouse: isSuperAdmin,
    canPromoteToSuperAdmin: isSuperAdmin,
  };
}

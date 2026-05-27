// Supabase-compatible type definitions — replaces the old Firebase type file.
// Timestamps are ISO strings (Supabase returns strings, not Firebase Timestamp objects).

export type ISOTimestamp = string;

// ── Users / Auth ──────────────────────────────────────────────────────────────
export interface User {
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: ISOTimestamp;
  lastLoginAt: ISOTimestamp;
}

export interface Device {
  userId: string;
  fcmToken: string;
  platform: 'android' | 'web';
  appVersion: string;
  lastActiveAt: ISOTimestamp;
}

export interface UserIndex {
  organizationId: string;
  email: string;
  role: 'owner' | 'manager' | 'staff';
}

export interface UserEmailIndex {
  userId: string;
  email: string;
  organizationId: string;
}

// ── Organization ──────────────────────────────────────────────────────────────
export interface Organization {
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  createdAt: ISOTimestamp;
  ownerId: string;
  settings: {
    lowStockThreshold: number;
    currency: string;
    timezone: string;
  };
}

export interface OrgMember {
  role: 'owner' | 'manager' | 'staff';
  active: boolean;
  createdAt: ISOTimestamp;
  invitedBy: string;
  lastActiveAt: ISOTimestamp;
}

// ── Inventory ─────────────────────────────────────────────────────────────────
export interface InventoryItem {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  lastUsedAt: ISOTimestamp;
  lastModifiedAt: ISOTimestamp;
  isActive: boolean;
  priority: boolean;
  source: 'manual' | 'zoho' | 'pos';
  organizationId: string;
  createdBy: string;
  metadata: {
    description?: string;
    unit?: string;
    location?: string;
  };
}

export interface InventoryStats {
  monthlyMoves: number;
  yearlyMoves: number;
  dormantScore: number;
  lastCalculated: ISOTimestamp;
  organizationId: string;
}

// ── Stock Take ────────────────────────────────────────────────────────────────
export interface StockTakeSession {
  status: 'open' | 'closed' | 'approved';
  startedBy: string;
  startedAt: ISOTimestamp;
  closedAt?: ISOTimestamp;
  approvedBy?: string;
  approvedAt?: ISOTimestamp;
  organizationId: string;
  description?: string;
  itemCount: number;
}

export interface StockTakeEntry {
  sessionId: string;
  itemId: string;
  countedQty: number;
  scannedBy: string;
  scannedAt: ISOTimestamp;
  organizationId: string;
  notes?: string;
}

// ── Approvals ─────────────────────────────────────────────────────────────────
export interface ApprovalRequest {
  type: 'stock_adjustment' | 'zoho_write' | 'bulk_import';
  itemId: string;
  delta: number;
  reason: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: ISOTimestamp;
  createdAt: ISOTimestamp;
  organizationId: string;
  metadata?: any;
}

// ── Activity Logs ─────────────────────────────────────────────────────────────
export interface ActivityLog {
  type: 'scan' | 'approval' | 'sync' | 'login' | 'invite';
  entityType: 'inventory' | 'user' | 'session' | 'organization';
  entityId: string;
  actorId: string;
  createdAt: ISOTimestamp;
  organizationId: string;
  details: {
    before?: any;
    after?: any;
    delta?: any;
    metadata?: any;
  };
}

// ── Notifications ─────────────────────────────────────────────────────────────
export interface Notification {
  targetUserId: string | 'ALL';
  title: string;
  body: string;
  read: boolean;
  createdAt: ISOTimestamp;
  organizationId: string;
  type: 'approval' | 'low_stock' | 'stock_take' | 'system';
  actionUrl?: string;
  metadata?: any;
}

export interface OrgSetting {
  key: string;
  value: any;
  updatedBy: string;
  updatedAt: ISOTimestamp;
  organizationId: string;
}

// ── Scalar helpers ────────────────────────────────────────────────────────────
export type UserRole       = 'owner' | 'manager' | 'staff';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type SessionStatus  = 'open' | 'closed' | 'approved';
export type NotificationType = 'approval' | 'low_stock' | 'stock_take' | 'system';
export type ActivityType   = 'scan' | 'approval' | 'sync' | 'login' | 'invite';
export type EntityType     = 'inventory' | 'user' | 'session' | 'organization';

// ── Composed types ────────────────────────────────────────────────────────────
export interface InventoryWithStats extends InventoryItem {
  stats?: InventoryStats;
}

export interface ApprovalRequestWithItem extends ApprovalRequest {
  item?: InventoryItem;
}

export interface ActivityLogWithDetails extends ActivityLog {
  actorName?: string;
  entityName?: string;
}

// ── API responses ─────────────────────────────────────────────────────────────
export interface DashboardData {
  inventory: InventoryItem[];
  priorityItems: InventoryItem[];
  lowStockItems: InventoryItem[];
  recentActivity: ActivityLog[];
  pendingApprovals: ApprovalRequest[];
  notifications: Notification[];
  stats: {
    totalItems: number;
    lowStockCount: number;
    pendingApprovals: number;
    activeStockTakes: number;
  };
}

export interface StockTakeData {
  session: StockTakeSession;
  entries: StockTakeEntry[];
  progress: {
    scannedCount: number;
    totalCount: number;
    completionPercentage: number;
  };
}

// ── Forms ─────────────────────────────────────────────────────────────────────
export interface CreateInventoryItemForm {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  description?: string;
  unit?: string;
  location?: string;
}

export interface CreateApprovalRequestForm {
  itemId: string;
  delta: number;
  reason: string;
  type: 'stock_adjustment' | 'zoho_write' | 'bulk_import';
}

export interface InviteUserForm {
  email: string;
  role: UserRole;
  displayName?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────
export interface AppError extends Error {
  code: string;
  details?: any;
}

export interface ValidationError extends Error {
  field: string;
  code: 'required' | 'invalid' | 'duplicate' | 'permission_denied';
}

/** @deprecated Renamed to AppError — Firebase has been removed */
export type FirebaseError = AppError;

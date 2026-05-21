// Import new Firebase types
export * from './types/firebase';
import type { 
  Organization as FirebaseOrganization,
  InventoryItem as FirebaseInventoryItem,
  ActivityLog as FirebaseActivityLog,
  OrgMember,
  UserRole as FirebaseUserRole
} from './types/firebase';

// Enums - Updated to match new architecture
export enum UserRole {
    Admin = 'owner', // Map Admin to owner
    Member = 'staff', // Map Member to staff
    Manager = 'manager' // Add manager role
}

export enum View {
    Dashboard = 'dashboard',
    Inventory = 'inventory',
    ItemDetail = 'itemDetail',
    StockTake = 'stockTake',
    PurchaseOrders = 'purchaseOrders',
    PriorityItems = 'priorityItems',
    Reports = 'reports',
    Activity = 'activity',
    Integrations = 'integrations',
    Billing = 'billing',
    BillingSuccess = 'billingSuccess',
    BillingCancel = 'billingCancel',
    Settings = 'settings',
    LowStock = 'lowStock',
    ZohoApprovals = 'zohoApprovals',
    Categories = 'categories',
}

// Legacy interfaces for backward compatibility
export interface ZohoIntegration {
    status: 'connected' | 'disconnected';
    connectedAt?: string;
}

export type PosProvider = 'odoo' | 'square' | 'shopify' | 'custom';

export interface PosIntegration {
    status: 'connected' | 'disconnected';
    provider?: PosProvider;
    connectedAt?: string;
    baseUrl?: string;
    username?: string;
    database?: string;
}

export interface Subscription {
    plan: 'Free' | 'Pro' | 'Enterprise';
    status: 'active' | 'trialing' | 'canceled';
    endDate?: string;
}

export interface StockTakeOrgSettings {
    /** Value impact in ZAR above which an adjustment is flagged high-risk and requires explicit acknowledgement. Default 5000. */
    riskThresholdRands: number;
}

// Updated Organization interface - extends Firebase version
export interface Organization extends Omit<FirebaseOrganization, 'plan'> {
    id: string;
    categories: string[];
    integrations: {
        zoho: ZohoIntegration;
        pos?: PosIntegration;
    };
    subscription: Subscription;
    stockTakeSettings?: StockTakeOrgSettings;
}

export type AuditEventType =
    | 'approval_created'
    | 'approved'
    | 'rejected'
    | 'zoho_synced';

export interface AuditLedgerEntry {
    id?: string;
    event: AuditEventType;
    timestamp: any; // Firestore serverTimestamp
    actor: string;          // UID
    actorName: string;
    approvalId: string;
    sessionId?: string;
    itemId?: string;
    itemName?: string;
    itemSKU?: string;
    quantityDelta?: number;
    newQuantity?: number;
    expectedQuantity?: number;
    unitCost?: number;
    valueImpact?: number;
    riskFlagged?: boolean;
    approvalComment?: string;
    rejectionReason?: string;
    zohoAdjustmentId?: string;
}

// Legacy User interface - will be migrated to OrgMember + User pattern
export interface User {
    uid: string;
    name: string;
    email: string;
    role: UserRole;
    organizationId: string;
    invited?: boolean;
    invitedAt?: string;
    onboardingCompleted?: boolean;
    themePreference?: 'light' | 'dark';
    savedNotificationSettings?: NotificationSettings;
    savedAnalyticsSettings?: { autoRefresh: boolean; refreshInterval: number; showAdvancedMetrics: boolean };
}

// Legacy InventoryItem - extends Firebase version for backward compatibility
export interface InventoryItem extends Omit<FirebaseInventoryItem, 'quantity' | 'organizationId' | 'createdBy'> {
    id: string;
    organizationId: string;
    stock: number; // Maps to quantity in new model
    threshold: number;
    supplier: string;
    // Pricing fields
    cost?: number;
    price?: number;
    currency?: string;
    // Sync fields  
    lastSynced?: string;
    syncStatus?: 'synced' | 'pending' | 'conflict' | 'error';
    zohoId?: string;
    // Usage analytics
    lastUsed?: string; // Maps to lastUsedAt
    usageCount?: number;
    totalUsed?: number;
    // Custodial Tracking (SA Compliance - Third-Party Goods)
    ownerID?: string; // If set, this is custodial inventory (not on balance sheet)
    ownerName?: string; // Display name of the owner
    ownerType?: 'own' | 'customer' | 'supplier' | 'thirdParty'; // Classification
    custodialNotes?: string; // Why we're holding this
}

// Legacy ActivityLogEntry - maps to new ActivityLog
export interface ActivityLogEntry {
    id: string;
    organizationId: string;
    user: string; // Maps to actorId
    userName?: string;
    action: string; // Maps to type
    timestamp: string; // Maps to createdAt
    target?: string; // Maps to entityType
    description?: string;
    metadata?: { [key: string]: any };
    archived?: boolean;
    archivedAt?: string;
    details?: string | {
        itemId?: string;
        itemName?: string;
        itemSku?: string;
        change?: {
            field: 'stock' | 'price' | 'cost' | 'threshold' | 'category' | 'supplier';
            from: any;
            to: any;
        };
        metadata?: {
            importSource?: string;
            batchSize?: number;
            duplicatesOverwritten?: number;
            userId?: string;
            userRole?: string;
        };
    }
}

export interface RestockSuggestion {
  sku: string;
  name: string;
  suggestedQuantity: number;
  priority: 'High' | 'Medium' | 'Low';
}

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface NotificationSettings {
    enabled: boolean;
    target: 'all' | 'mostUsed';
    mostUsedCount: number;
}

export interface ZohoSyncSettings {
    frequency: 'daily' | 'weekly' | 'manual';
    defaultCategory: string;
}

export interface Settings {
    lowStockThreshold: number;
    notificationSettings: NotificationSettings;
    theme: 'light' | 'dark';
    zohoSync: ZohoSyncSettings;
    analytics: {
        autoRefresh: boolean;
        refreshInterval: number; // in minutes
        showAdvancedMetrics: boolean;
    };
}

export interface AppState {
    inventory: InventoryItem[];
    users: User[];
    categories: string[];
    activityLogs: ActivityLogEntry[];
    currentUser: User;
    currentOrganization: Organization;
    settings: Settings;
    selectedItemId: string | null;
    loading: {
        inventory: boolean;
        users: boolean;
        suggestions: boolean;
        sync: boolean;
    };
    error: string | null;
}

// Reducer actions
export type Action =
    | { type: 'SET_INITIAL_DATA'; payload: { inventory: InventoryItem[], users: User[], activityLogs: ActivityLogEntry[], organization: Organization } }
    | { type: 'SET_LOADING'; payload: { key: keyof AppState['loading']; value: boolean } }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'ADD_ITEM'; payload: InventoryItem }
    | { type: 'UPDATE_ITEM'; payload: InventoryItem }
    | { type: 'DELETE_ITEM'; payload: string } // by ID
    | { type: 'ADD_USER'; payload: User }
    | { type: 'UPDATE_USER'; payload: User }
    | { type: 'DELETE_USER'; payload: string } // by UID
    | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> }
    | { type: 'UPDATE_ORGANIZATION'; payload: Partial<Organization> }
    | { type: 'UPDATE_INTEGRATION'; payload: Partial<Organization['integrations']> }
    | { type: 'UPDATE_SUBSCRIPTION'; payload: Partial<Organization['subscription']> }
    | { type: 'ADD_LOG'; payload: Omit<ActivityLogEntry, 'id' | 'timestamp' | 'organizationId'> }
    | { type: 'SET_ACTIVITY_LOGS'; payload: ActivityLogEntry[] }
    | { type: 'ADD_REALTIME_LOG'; payload: ActivityLogEntry }
    | { type: 'ARCHIVE_ALL_LOGS'; payload?: void }
    | { type: 'ARCHIVE_OLD_LOGS'; payload?: void }
    | { type: 'SET_SELECTED_ITEM'; payload: string | null }
    | { type: 'SET_CATEGORIES'; payload: string[] }
    | { type: 'SET_INVENTORY'; payload: InventoryItem[] }
    | { type: 'SET_USERS'; payload: User[] };

export interface StockTakeProgressItem {
    id: string;
    sku: string;
    name: string;
    countedStock: number;
    countedBy: string;
    timestamp: string;
}

export interface DiscrepancyItem {
    id: string;
    sku: string;
    name: string;
    expectedStock: number;
    countedStock: number;
    discrepancy: number;
    // Optional timestamps recorded during stock take
    scannedAt?: number; // epoch ms when the scan was recorded
    scannedDate?: string; // human-friendly date string (YYYY-MM-DD)
    scannedTime?: string; // human-friendly time string (HH:MM:SS)
}

export interface PriorityItem {
    id: string;
    organizationId: string;
    itemId: string; // reference to inventory item id
    category: string; // e.g., 'Battery', 'LCD/Front Housing', etc.
    note?: string;
    addedAt?: string;
}

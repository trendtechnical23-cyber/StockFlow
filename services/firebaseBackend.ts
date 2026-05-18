// Firebase Backend Service - Production Architecture Implementation
// Implements the new canonical data model with proper query patterns

import { 
  doc, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs, 
  getDoc,
  addDoc, 
  updateDoc, 
  writeBatch,
  onSnapshot,
  Timestamp,
  arrayUnion,
  serverTimestamp 
} from 'firebase/firestore';
import { ref, set, onValue, off } from 'firebase/database';
import { db, rtdb } from './firebaseConfig';
import type {
  Organization,
  OrgMember,
  InventoryItem,
  ActivityLog,
  ApprovalRequest,
  Notification,
  StockTakeSession,
  StockTakeEntry,
  DashboardData,
  UserRole
} from './types/firebase';

// ========================================================================
// CORE SERVICE CLASS
// ========================================================================

export class FirebaseBackendService {
  private userId: string;
  private orgId: string;
  private signalListener?: () => void;

  constructor(userId: string, orgId: string) {
    this.userId = userId;
    this.orgId = orgId;
  }

  // ========================================================================
  // ORGANIZATION MANAGEMENT
  // ========================================================================

  async getOrganization(): Promise<Organization | null> {
    const orgDoc = await getDoc(doc(db, 'organizations', this.orgId));
    return orgDoc.exists() ? { id: orgDoc.id, ...orgDoc.data() } as Organization : null;
  }

  async getOrgMember(userId?: string): Promise<OrgMember | null> {
    const targetUserId = userId || this.userId;
    const memberDoc = await getDoc(doc(db, `organizations/${this.orgId}/members`, targetUserId));
    return memberDoc.exists() ? memberDoc.data() as OrgMember : null;
  }

  async hasRole(role: UserRole): Promise<boolean> {
    const member = await this.getOrgMember();
    if (!member || !member.active) return false;
    
    switch (role) {
      case 'owner': return member.role === 'owner';
      case 'manager': return member.role === 'owner' || member.role === 'manager';
      case 'staff': return ['owner', 'manager', 'staff'].includes(member.role);
      default: return false;
    }
  }

  // ========================================================================
  // INVENTORY MANAGEMENT - OPTIMIZED QUERIES
  // ========================================================================

  async getInventory(options?: {
    activeOnly?: boolean;
    priorityOnly?: boolean;
    category?: string;
    limit?: number;
  }): Promise<InventoryItem[]> {
    const opts = { activeOnly: true, limit: 50, ...options };
    
    let q = query(
      collection(db, `organizations/${this.orgId}/inventory`),
      where('organizationId', '==', this.orgId)
    );

    if (opts.activeOnly) {
      q = query(q, where('isActive', '==', true));
    }

    if (opts.priorityOnly) {
      q = query(q, where('priority', '==', true));
    }

    if (opts.category) {
      q = query(q, where('category', '==', opts.category));
    }

    q = query(q, orderBy('lastUsedAt', 'desc'), limit(opts.limit));

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
  }

  async getInventoryItem(itemId: string): Promise<InventoryItem | null> {
    const itemDoc = await getDoc(doc(db, `organizations/${this.orgId}/inventory`, itemId));
    return itemDoc.exists() ? { id: itemDoc.id, ...itemDoc.data() } as InventoryItem : null;
  }

  async getLowStockItems(threshold?: number): Promise<InventoryItem[]> {
    // Note: This query requires a custom index on organizationId + quantity
    const q = query(
      collection(db, `organizations/${this.orgId}/inventory`),
      where('organizationId', '==', this.orgId),
      where('isActive', '==', true),
      where('quantity', '<=', threshold || 10),
      orderBy('quantity', 'asc'),
      limit(50)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
  }

  // ========================================================================
  // APPROVAL WORKFLOW - NEW PATTERN
  // ========================================================================

  async createApprovalRequest(request: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt' | 'organizationId'>): Promise<string> {
    const approvalData: Omit<ApprovalRequest, 'id'> = {
      ...request,
      status: 'pending',
      createdAt: Timestamp.now(),
      organizationId: this.orgId
    };

    const docRef = await addDoc(collection(db, `organizations/${this.orgId}/approvalRequests`), approvalData);
    
    // Log activity
    await this.logActivity({
      type: 'approval',
      entityType: 'inventory',
      entityId: request.itemId,
      details: {
        requestId: docRef.id,
        type: request.type,
        delta: request.delta,
        reason: request.reason
      }
    });

    return docRef.id;
  }

  async approveRequest(requestId: string): Promise<void> {
    if (!(await this.hasRole('manager'))) {
      throw new Error('Only managers can approve requests');
    }

    const batch = writeBatch(db);
    
    // Get the request
    const requestDoc = await getDoc(doc(db, `organizations/${this.orgId}/approvalRequests`, requestId));
    if (!requestDoc.exists()) throw new Error('Request not found');
    
    const request = requestDoc.data() as ApprovalRequest;
    
    // Update request status
    batch.update(doc(db, `organizations/${this.orgId}/approvalRequests`, requestId), {
      status: 'approved',
      approvedBy: this.userId,
      approvedAt: Timestamp.now()
    });

    // Update inventory item
    const itemRef = doc(db, `organizations/${this.orgId}/inventory`, request.itemId);
    batch.update(itemRef, {
      quantity: request.delta, // This should use FieldValue.increment in production
      lastModifiedAt: Timestamp.now()
    });

    // Log activity
    const logRef = doc(collection(db, `organizations/${this.orgId}/activityLogs`));
    batch.set(logRef, {
      type: 'approval',
      entityType: 'inventory',
      entityId: request.itemId,
      actorId: this.userId,
      createdAt: Timestamp.now(),
      organizationId: this.orgId,
      details: {
        requestId,
        approved: true,
        delta: request.delta,
        reason: request.reason
      }
    });

    await batch.commit();
  }

  async getPendingApprovals(): Promise<ApprovalRequest[]> {
    const q = query(
      collection(db, `organizations/${this.orgId}/approvalRequests`),
      where('organizationId', '==', this.orgId),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ApprovalRequest));
  }

  // ========================================================================
  // ACTIVITY LOGS - APPEND-ONLY AUDIT TRAIL
  // ========================================================================

  async logActivity(activity: Omit<ActivityLog, 'id' | 'actorId' | 'createdAt' | 'organizationId'>): Promise<void> {
    const logData: Omit<ActivityLog, 'id'> = {
      ...activity,
      actorId: this.userId,
      createdAt: Timestamp.now(),
      organizationId: this.orgId
    };

    await addDoc(collection(db, `organizations/${this.orgId}/activityLogs`), logData);
  }

  async getActivityLogs(options?: { type?: string; limit?: number }): Promise<ActivityLog[]> {
    const opts = { limit: 100, ...options };
    
    let q = query(
      collection(db, `organizations/${this.orgId}/activityLogs`),
      where('organizationId', '==', this.orgId)
    );

    if (opts.type) {
      q = query(q, where('type', '==', opts.type));
    }

    q = query(q, orderBy('createdAt', 'desc'), limit(opts.limit));

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLog));
  }

  // ========================================================================
  // NOTIFICATIONS - EVENT-DRIVEN, NOT REAL-TIME
  // ========================================================================

  async createNotification(notification: Omit<Notification, 'id' | 'read' | 'createdAt' | 'organizationId'>): Promise<void> {
    if (!(await this.hasRole('manager'))) {
      throw new Error('Only managers can create notifications');
    }

    const notificationData: Omit<Notification, 'id'> = {
      ...notification,
      readBy: [],
      createdAt: serverTimestamp(),
      organizationId: this.orgId
    } as any;

    await addDoc(collection(db, `organizations/${this.orgId}/notifications`), notificationData);
    
    // Send signal to RTDB (optional)
    await this.sendSignal();
  }

  async getNotifications(): Promise<Notification[]> {
    const q = query(
      collection(db, `organizations/${this.orgId}/notifications`),
      where('targetUserId', 'in', [this.userId, 'ALL']),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id, 
        ...data,
        read: (data.readBy || []).includes(this.userId)
      } as Notification;
    });
  }

  async markNotificationAsRead(notificationId: string): Promise<void> {
    await updateDoc(doc(db, `organizations/${this.orgId}/notifications`, notificationId), {
      readBy: arrayUnion(this.userId),
      readAt: serverTimestamp()
    });
  }

  // ========================================================================
  // STOCK TAKE SESSIONS
  // ========================================================================

  async createStockTakeSession(description?: string): Promise<string> {
    const sessionData: Omit<StockTakeSession, 'id'> = {
      status: 'open',
      startedBy: this.userId,
      startedAt: Timestamp.now(),
      organizationId: this.orgId,
      description,
      itemCount: 0
    };

    const docRef = await addDoc(collection(db, `organizations/${this.orgId}/stockTakeSessions`), sessionData);
    
    await this.logActivity({
      type: 'stock_take',
      entityType: 'session',
      entityId: docRef.id,
      details: { action: 'started', description }
    });

    return docRef.id;
  }

  async addStockTakeEntry(sessionId: string, itemId: string, countedQty: number, notes?: string): Promise<void> {
    const entryData: Omit<StockTakeEntry, 'id'> = {
      sessionId,
      itemId,
      countedQty,
      scannedBy: this.userId,
      scannedAt: Timestamp.now(),
      organizationId: this.orgId,
      notes
    };

    await addDoc(collection(db, `organizations/${this.orgId}/stockTakeEntries`), entryData);
  }

  // ========================================================================
  // RTDB SIGNALS - MINIMAL REAL-TIME LAYER
  // ========================================================================

  private async sendSignal(): Promise<void> {
    if (!rtdb) return;
    
    await set(ref(rtdb, `signals/${this.userId}`), {
      lastEventAt: Date.now(),
      type: 'notification'
    });
  }

  setupSignalListener(callback: () => void): void {
    if (!rtdb) return;
    
    const signalRef = ref(rtdb, `signals/${this.userId}`);
    
    this.signalListener = () => {
      onValue(signalRef, (snapshot) => {
        if (snapshot.exists()) {
          callback();
        }
      });
    };
    
    this.signalListener();
  }

  removeSignalListener(): void {
    if (!rtdb || !this.signalListener) return;
    
    const signalRef = ref(rtdb, `signals/${this.userId}`);
    off(signalRef);
    this.signalListener = undefined;
  }

  // ========================================================================
  // DASHBOARD DATA - SINGLE QUERY PATTERN
  // ========================================================================

  async getDashboardData(): Promise<DashboardData> {
    // Load data in parallel - no listeners!
    const [
      inventory,
      priorityItems,
      lowStockItems,
      recentActivity,
      pendingApprovals,
      notifications
    ] = await Promise.all([
      this.getInventory({ limit: 50 }),
      this.getInventory({ priorityOnly: true, limit: 20 }),
      this.getLowStockItems(),
      this.getActivityLogs({ limit: 50 }),
      this.getPendingApprovals(),
      this.getNotifications()
    ]);

    return {
      inventory,
      priorityItems,
      lowStockItems,
      recentActivity,
      pendingApprovals,
      notifications,
      stats: {
        totalItems: inventory.length,
        lowStockCount: lowStockItems.length,
        pendingApprovals: pendingApprovals.length,
        activeStockTakes: 0 // TODO: Get from stock take sessions
      }
    };
  }

  // ========================================================================
  // CLEANUP
  // ========================================================================

  dispose(): void {
    this.removeSignalListener();
  }
}

// ========================================================================
// SINGLETON FACTORY
// ========================================================================

let serviceInstance: FirebaseBackendService | null = null;

export const createBackendService = (userId: string, orgId: string): FirebaseBackendService => {
  if (serviceInstance) {
    serviceInstance.dispose();
  }
  
  serviceInstance = new FirebaseBackendService(userId, orgId);
  return serviceInstance;
};

export const getBackendService = (): FirebaseBackendService => {
  if (!serviceInstance) {
    throw new Error('Backend service not initialized. Call createBackendService first.');
  }
  return serviceInstance;
};

// ========================================================================
// MIGRATION HELPERS
// ========================================================================

export const migrationHelpers = {
  // Convert legacy InventoryItem to new format
  convertLegacyInventoryItem: (legacy: any): Omit<InventoryItem, 'id'> => ({
    sku: legacy.sku || legacy.barcode || `AUTO-${Date.now()}`,
    name: legacy.name || 'Unnamed Item',
    category: legacy.category || 'Uncategorized',
    quantity: legacy.stock || 0,
    lastUsedAt: legacy.lastUsed ? Timestamp.fromDate(new Date(legacy.lastUsed)) : Timestamp.now(),
    lastModifiedAt: legacy.lastModified ? Timestamp.fromDate(new Date(legacy.lastModified)) : Timestamp.now(),
    isActive: legacy.isActive !== false,
    priority: legacy.priority === true,
    source: legacy.source || 'manual',
    organizationId: legacy.organizationId,
    createdBy: legacy.createdBy || 'migration',
    metadata: {
      description: legacy.description,
      unit: legacy.unit,
      supplier: legacy.supplier
    }
  }),

  // Convert legacy ActivityLogEntry to new format
  convertLegacyActivityLog: (legacy: any): Omit<ActivityLog, 'id'> => ({
    type: legacy.action || legacy.type || 'unknown',
    entityType: legacy.target || 'inventory',
    entityId: legacy.entityId || legacy.itemId || '',
    actorId: legacy.user || legacy.userId || legacy.actorId,
    createdAt: legacy.timestamp ? Timestamp.fromDate(new Date(legacy.timestamp)) : Timestamp.now(),
    organizationId: legacy.organizationId,
    details: {
      before: legacy.details?.before,
      after: legacy.details?.after,
      delta: legacy.details?.delta,
      metadata: legacy.metadata || legacy.details
    }
  })
};
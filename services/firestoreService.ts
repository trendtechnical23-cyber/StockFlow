/**
 * Production-Grade Firestore Service Layer
 * 
 * Features:
 * - Organization-scoped collections
 * - Role-based access control
 * - Quota-optimized queries
 * - Inventory split (active/archive)
 * - Pending changes workflow
 * - Direct notifications (no global listeners)
 */

import {
  firestore,
  auth,
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  writeBatch
} from './firebase';
import { InventoryItem, User, ActivityLogEntry, UserRole } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface OrgMember {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  joinedAt: any;
  lastSeen?: any;
}

export interface PendingChange {
  id?: string;
  itemId: string;
  changeType: 'add' | 'remove' | 'update' | 'create' | 'delete';
  quantity?: number;
  updates?: Partial<InventoryItem>;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: any;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: any;
  reviewNotes?: string;
}

export interface ApprovalRequest {
  id?: string;
  type: 'inventory_change' | 'low_stock_order' | 'bulk_update';
  itemId?: string;
  itemName?: string;
  changeId?: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: any;
  status: 'pending' | 'approved' | 'rejected';
  priority: 'low' | 'medium' | 'high';
  details: any;
}

export interface NotificationDoc {
  id?: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: any;
  read?: boolean; // Legacy
  readBy?: string[];
  createdAt: any;
}

// ============================================================================
// FIRESTORE SERVICE CLASS
// ============================================================================

export class FirestoreService {
  private static instance: FirestoreService;
  
  static getInstance(): FirestoreService {
    if (!FirestoreService.instance) {
      FirestoreService.instance = new FirestoreService();
    }
    return FirestoreService.instance;
  }

  // ==========================================================================
  // MEMBERS (Role Management)
  // ==========================================================================

  async getMember(orgId: string, userId: string): Promise<OrgMember | null> {
    try {
      const memberRef = doc(firestore, `organizations/${orgId}/members/${userId}`);
      const memberSnap = await getDoc(memberRef);
      
      if (!memberSnap.exists()) return null;
      
      return { userId, ...memberSnap.data() } as OrgMember;
    } catch (error) {
      console.error('Error getting member:', error);
      return null;
    }
  }

  async getMembers(orgId: string): Promise<OrgMember[]> {
    try {
      const membersRef = collection(firestore, `organizations/${orgId}/members`);
      const snapshot = await getDocs(membersRef);
      
      return snapshot.docs.map(doc => ({
        userId: doc.id,
        ...doc.data()
      })) as OrgMember[];
    } catch (error) {
      console.error('Error getting members:', error);
      return [];
    }
  }

  async setMember(orgId: string, userId: string, data: Partial<OrgMember>): Promise<void> {
    const memberRef = doc(firestore, `organizations/${orgId}/members/${userId}`);
    await setDoc(memberRef, {
      ...data,
      userId,
      joinedAt: data.joinedAt || serverTimestamp()
    }, { merge: true });
  }

  async updateMemberRole(orgId: string, userId: string, role: UserRole): Promise<void> {
    const memberRef = doc(firestore, `organizations/${orgId}/members/${userId}`);
    await updateDoc(memberRef, { role });
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    const memberRef = doc(firestore, `organizations/${orgId}/members/${userId}`);
    await deleteDoc(memberRef);
  }

  // ==========================================================================
  // INVENTORY (Active Items Only)
  // ==========================================================================

  async getActiveInventory(orgId: string, limitCount: number = 200): Promise<InventoryItem[]> {
    try {
      const inventoryRef = collection(firestore, `organizations/${orgId}/inventory`);
      const q = query(
        inventoryRef,
        orderBy('lastUsed', 'desc'),
        limit(limitCount)
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as InventoryItem[];
    } catch (error) {
      console.error('Error getting active inventory:', error);
      return [];
    }
  }

  async getInventoryItem(orgId: string, itemId: string): Promise<InventoryItem | null> {
    try {
      const itemRef = doc(firestore, `organizations/${orgId}/inventory/${itemId}`);
      const itemSnap = await getDoc(itemRef);
      
      if (!itemSnap.exists()) return null;
      
      return { id: itemId, ...itemSnap.data() } as InventoryItem;
    } catch (error) {
      console.error('Error getting inventory item:', error);
      return null;
    }
  }

  async createInventoryItem(orgId: string, item: Partial<InventoryItem>): Promise<string> {
    const inventoryRef = collection(firestore, `organizations/${orgId}/inventory`);
    const docRef = await addDoc(inventoryRef, {
      ...item,
      lastUsed: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    return docRef.id;
  }

  async updateInventoryItem(orgId: string, itemId: string, updates: Partial<InventoryItem>): Promise<void> {
    const itemRef = doc(firestore, `organizations/${orgId}/inventory/${itemId}`);
    await updateDoc(itemRef, {
      ...updates,
      lastUsed: serverTimestamp()
    });
  }

  async deleteInventoryItem(orgId: string, itemId: string): Promise<void> {
    const itemRef = doc(firestore, `organizations/${orgId}/inventory/${itemId}`);
    await deleteDoc(itemRef);
  }

  async searchInventory(orgId: string, searchTerm: string, limitCount: number = 50): Promise<InventoryItem[]> {
    try {
      const inventoryRef = collection(firestore, `organizations/${orgId}/inventory`);
      const snapshot = await getDocs(inventoryRef);
      
      const lowerSearch = searchTerm.toLowerCase();
      const filtered = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem))
        .filter(item => 
          item.name?.toLowerCase().includes(lowerSearch) ||
          item.sku?.toLowerCase().includes(lowerSearch) ||
          item.category?.toLowerCase().includes(lowerSearch)
        )
        .slice(0, limitCount);
      
      return filtered;
    } catch (error) {
      console.error('Error searching inventory:', error);
      return [];
    }
  }

  // ==========================================================================
  // ARCHIVE INVENTORY (Inactive Items 6+ Months)
  // ==========================================================================

  async getArchivedInventory(orgId: string, limitCount: number = 100): Promise<InventoryItem[]> {
    try {
      const archiveRef = collection(firestore, `organizations/${orgId}/archiveInventory`);
      const q = query(archiveRef, orderBy('archivedAt', 'desc'), limit(limitCount));
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as InventoryItem[];
    } catch (error) {
      console.error('Error getting archived inventory:', error);
      return [];
    }
  }

  async archiveInventoryItem(orgId: string, itemId: string): Promise<void> {
    const batch = writeBatch(firestore);
    
    // Get item from active inventory
    const itemRef = doc(firestore, `organizations/${orgId}/inventory/${itemId}`);
    const itemSnap = await getDoc(itemRef);
    
    if (!itemSnap.exists()) throw new Error('Item not found');
    
    // Move to archive
    const archiveRef = doc(firestore, `organizations/${orgId}/archiveInventory/${itemId}`);
    batch.set(archiveRef, {
      ...itemSnap.data(),
      archivedAt: serverTimestamp()
    });
    
    // Delete from active
    batch.delete(itemRef);
    
    await batch.commit();
  }

  async restoreFromArchive(orgId: string, itemId: string): Promise<void> {
    const batch = writeBatch(firestore);
    
    // Get item from archive
    const archiveRef = doc(firestore, `organizations/${orgId}/archiveInventory/${itemId}`);
    const archiveSnap = await getDoc(archiveRef);
    
    if (!archiveSnap.exists()) throw new Error('Archived item not found');
    
    // Move back to active
    const itemRef = doc(firestore, `organizations/${orgId}/inventory/${itemId}`);
    const data = archiveSnap.data();
    delete data.archivedAt;
    
    batch.set(itemRef, {
      ...data,
      lastUsed: serverTimestamp()
    });
    
    // Delete from archive
    batch.delete(archiveRef);
    
    await batch.commit();
  }

  // ==========================================================================
  // PENDING CHANGES (Staff Request Queue)
  // ==========================================================================

  async createPendingChange(orgId: string, change: Omit<PendingChange, 'id'>): Promise<string> {
    const changesRef = collection(firestore, `organizations/${orgId}/pendingChanges`);
    const docRef = await addDoc(changesRef, {
      ...change,
      requestedAt: serverTimestamp(),
      status: 'pending'
    });
    return docRef.id;
  }

  async getPendingChanges(orgId: string, status?: 'pending' | 'approved' | 'rejected'): Promise<PendingChange[]> {
    try {
      const changesRef = collection(firestore, `organizations/${orgId}/pendingChanges`);
      const q = status
        ? query(changesRef, where('status', '==', status), orderBy('requestedAt', 'desc'))
        : query(changesRef, orderBy('requestedAt', 'desc'));
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PendingChange[];
    } catch (error) {
      console.error('Error getting pending changes:', error);
      return [];
    }
  }

  async updatePendingChange(orgId: string, changeId: string, updates: Partial<PendingChange>): Promise<void> {
    const changeRef = doc(firestore, `organizations/${orgId}/pendingChanges/${changeId}`);
    await updateDoc(changeRef, updates);
  }

  async approvePendingChange(
    orgId: string,
    changeId: string,
    reviewerUserId: string,
    reviewerName: string,
    notes?: string
  ): Promise<void> {
    const changeRef = doc(firestore, `organizations/${orgId}/pendingChanges/${changeId}`);
    await updateDoc(changeRef, {
      status: 'approved',
      reviewedBy: reviewerUserId,
      reviewedByName: reviewerName,
      reviewedAt: serverTimestamp(),
      reviewNotes: notes || ''
    });
  }

  async rejectPendingChange(
    orgId: string,
    changeId: string,
    reviewerUserId: string,
    reviewerName: string,
    notes: string
  ): Promise<void> {
    const changeRef = doc(firestore, `organizations/${orgId}/pendingChanges/${changeId}`);
    await updateDoc(changeRef, {
      status: 'rejected',
      reviewedBy: reviewerUserId,
      reviewedByName: reviewerName,
      reviewedAt: serverTimestamp(),
      reviewNotes: notes
    });
  }

  // ==========================================================================
  // APPROVAL REQUESTS
  // ==========================================================================

  async createApprovalRequest(orgId: string, request: Omit<ApprovalRequest, 'id'>): Promise<string> {
    const requestsRef = collection(firestore, `organizations/${orgId}/approvalRequests`);
    const docRef = await addDoc(requestsRef, {
      ...request,
      requestedAt: serverTimestamp(),
      status: 'pending'
    });
    return docRef.id;
  }

  async getApprovalRequests(orgId: string, status?: string): Promise<ApprovalRequest[]> {
    try {
      const requestsRef = collection(firestore, `organizations/${orgId}/approvalRequests`);
      const q = status
        ? query(requestsRef, where('status', '==', status), orderBy('requestedAt', 'desc'))
        : query(requestsRef, orderBy('requestedAt', 'desc'));
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ApprovalRequest[];
    } catch (error) {
      console.error('Error getting approval requests:', error);
      return [];
    }
  }

  async updateApprovalRequest(orgId: string, requestId: string, updates: Partial<ApprovalRequest>): Promise<void> {
    const requestRef = doc(firestore, `organizations/${orgId}/approvalRequests/${requestId}`);
    await updateDoc(requestRef, updates);
  }

  // ==========================================================================
  // ACTIVITY LOGS (Append-Only Audit Trail)
  // ==========================================================================

  async createActivityLog(orgId: string, log: Omit<ActivityLogEntry, 'id' | 'timestamp' | 'organizationId'>): Promise<string> {
    const currentUser = auth.currentUser;
    const logsRef = collection(firestore, `organizations/${orgId}/activityLogs`);
    
    // Enhanced activity log with complete audit trail
    const enhancedLog = {
      ...log,
      organizationId: orgId,
      timestamp: serverTimestamp(),
      // Audit trail enhancements
      auditTrail: {
        userId: currentUser?.uid || 'system',
        userEmail: currentUser?.email || log.actionByEmail || 'system@stockflow.com',
        userName: currentUser?.displayName || log.actionBy || 'System User',
        sessionId: self.crypto.randomUUID(), // Unique session identifier
        ipAddress: 'client-side', // Would need backend service for real IP
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        source: log.metadata?.source || 'dashboard'
      },
      // Ensure we always have user information
      user: currentUser?.displayName || log.actionBy || currentUser?.email || 'Unknown User',
      userEmail: currentUser?.email || log.actionByEmail,
      userId: currentUser?.uid,
      // Enhanced details structure
      detailsStructured: {
        action: log.action,
        description: log.description || 'No description provided',
        itemAffected: log.itemName || 'N/A',
        metadata: {
          ...log.metadata,
          recordedAt: new Date().toISOString(),
          orgContext: orgId
        }
      }
    };
    
    const docRef = await addDoc(logsRef, enhancedLog);
    
    // Log to console for debugging
    console.log('🔍 Enhanced Activity Log Created:', {
      id: docRef.id,
      action: log.action,
      user: enhancedLog.auditTrail.userName,
      timestamp: new Date().toISOString()
    });
    
    return docRef.id;
  }

  async getActivityLogs(orgId: string, limitCount: number = 100): Promise<ActivityLogEntry[]> {
    try {
      const logsRef = collection(firestore, `organizations/${orgId}/activityLogs`);
      const q = query(logsRef, orderBy('timestamp', 'desc'), limit(limitCount));
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActivityLogEntry[];
    } catch (error) {
      console.error('Error getting activity logs:', error);
      return [];
    }
  }

  // ==========================================================================
  // NOTIFICATIONS (Per-User, Org-Scoped)
  // ==========================================================================

  async createNotification(orgId: string, notification: Omit<NotificationDoc, 'id'>): Promise<string> {
    const notificationsRef = collection(firestore, `organizations/${orgId}/notifications`);
    const docRef = await addDoc(notificationsRef, {
      ...notification,
      readBy: [],
      createdAt: serverTimestamp()
    });
    return docRef.id;
  }

  async getUserNotifications(orgId: string, userId: string, limitCount: number = 50): Promise<NotificationDoc[]> {
    try {
      const notificationsRef = collection(firestore, `organizations/${orgId}/notifications`);
      const q = query(
        notificationsRef,
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as NotificationDoc[];
    } catch (error) {
      console.error('Error getting notifications:', error);
      return [];
    }
  }

  async markNotificationRead(orgId: string, notificationId: string): Promise<void> {
    const notificationRef = doc(firestore, `organizations/${orgId}/notifications/${notificationId}`);
    const userId = auth.currentUser?.uid;
    if (userId) {
      await updateDoc(notificationRef, { 
        readBy: arrayUnion(userId),
        readAt: serverTimestamp() 
      });
    }
  }

  async markAllNotificationsRead(orgId: string, userId: string): Promise<void> {
    const notificationsRef = collection(firestore, `organizations/${orgId}/notifications`);
    // Fetch recent ones since we can't query "not in array"
    const q = query(
      notificationsRef,
      where('userId', '==', userId), // For firestoreService, userId is explicitly stored
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    
    const snapshot = await getDocs(q);
    const unreadDocs = snapshot.docs.filter(docSnap => {
      const data = docSnap.data();
      return !(data.readBy || []).includes(userId);
    });

    if (unreadDocs.length === 0) return;

    const batch = writeBatch(firestore);
    unreadDocs.forEach(docSnap => {
      batch.update(docSnap.ref, { 
        readBy: arrayUnion(userId),
        readAt: serverTimestamp()
      });
    });
    
    await batch.commit();
  }

  // ==========================================================================
  // LOW STOCK TRACKING
  // ==========================================================================

  async getLowStockItems(orgId: string): Promise<InventoryItem[]> {
    try {
      const inventoryRef = collection(firestore, `organizations/${orgId}/inventory`);
      const snapshot = await getDocs(inventoryRef);
      
      const lowStock = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem))
        .filter(item => item.stock <= (item.threshold || 10))
        .sort((a, b) => a.stock - b.stock);
      
      return lowStock;
    } catch (error) {
      console.error('Error getting low stock items:', error);
      return [];
    }
  }

  // ==========================================================================
  // DEVICES (APK Registration)
  // ==========================================================================

  async registerDevice(orgId: string, deviceId: string, deviceInfo: any): Promise<void> {
    const deviceRef = doc(firestore, `organizations/${orgId}/devices/${deviceId}`);
    await setDoc(deviceRef, {
      ...deviceInfo,
      lastSeen: serverTimestamp(),
      registeredAt: serverTimestamp()
    }, { merge: true });
  }

  async getDevices(orgId: string): Promise<any[]> {
    try {
      const devicesRef = collection(firestore, `organizations/${orgId}/devices`);
      const snapshot = await getDocs(devicesRef);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error getting devices:', error);
      return [];
    }
  }

  // ==========================================================================
  // CUSTOM DOCUMENT OPERATIONS (For Stock Take and Other Services)
  // ==========================================================================

  async createCustomDocument<T = any>(
    orgId: string,
    collectionName: string,
    documentId: string,
    data: T
  ): Promise<void> {
    try {
      const docRef = doc(firestore, `organizations/${orgId}/${collectionName}/${documentId}`);
      await setDoc(docRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error(`Error creating custom document in ${collectionName}:`, error);
      throw error;
    }
  }

  async getCustomDocument<T = any>(
    orgId: string,
    collectionName: string,
    documentId: string
  ): Promise<T | null> {
    try {
      const docRef = doc(firestore, `organizations/${orgId}/${collectionName}/${documentId}`);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) return null;
      
      return {
        id: docSnap.id,
        ...docSnap.data()
      } as T;
    } catch (error) {
      console.error(`Error getting custom document from ${collectionName}:`, error);
      return null;
    }
  }

  async updateCustomDocument<T = any>(
    orgId: string,
    collectionName: string,
    documentId: string,
    updates: Partial<T>
  ): Promise<void> {
    try {
      const docRef = doc(firestore, `organizations/${orgId}/${collectionName}/${documentId}`);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error(`Error updating custom document in ${collectionName}:`, error);
      throw error;
    }
  }

  async deleteCustomDocument(
    orgId: string,
    collectionName: string,
    documentId: string
  ): Promise<void> {
    try {
      const docRef = doc(firestore, `organizations/${orgId}/${collectionName}/${documentId}`);
      await deleteDoc(docRef);
    } catch (error) {
      console.error(`Error deleting custom document from ${collectionName}:`, error);
      throw error;
    }
  }

  async queryCustomDocuments<T = any>(
    orgId: string,
    collectionName: string,
    conditions: Array<{
      field: string;
      operator: any;
      value: any;
    }> = [],
    orderByField?: string,
    orderDirection: 'asc' | 'desc' = 'desc',
    limitCount?: number
  ): Promise<T[]> {
    try {
      const collectionRef = collection(firestore, `organizations/${orgId}/${collectionName}`);
      let q = query(collectionRef);

      // Apply where conditions
      conditions.forEach(condition => {
        q = query(q, where(condition.field, condition.operator, condition.value));
      });

      // Apply ordering
      if (orderByField) {
        q = query(q, orderBy(orderByField, orderDirection));
      }

      // Apply limit
      if (limitCount) {
        q = query(q, limit(limitCount));
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as T[];
    } catch (error) {
      console.error(`Error querying custom documents from ${collectionName}:`, error);
      return [];
    }
  }
}

// Export singleton instance
export const firestoreService = FirestoreService.getInstance();

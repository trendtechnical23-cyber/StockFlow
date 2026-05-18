/**
 * Centralized Stock Take Service
 * 
 * Migrated from direct Firestore usage to use the centralized FirestoreService
 * Provides better error handling, organization-scoped queries, and consistent architecture
 */

import { firestoreService } from './firestoreService';
import { database } from './firebase';
import { ref, onValue, get, remove, update, set } from 'firebase/database';

export interface StockTakeSession {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  deviceId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  startTime: number;
  endTime?: number;
  itemsScanned: number;
  scannedItems: ScannedItem[];
  createdAt?: any;
  updatedAt?: any;
}

export interface ScannedItem {
  itemId: string;
  itemName: string;
  sku: string;
  expectedQuantity: number;
  scannedQuantity: number;
  variance: number;
  scannedAt: number;
}

class CentralizedStockTakeService {
  private static instance: CentralizedStockTakeService;
  private activeSessionId: string | null = null;

  static getInstance(): CentralizedStockTakeService {
    if (!CentralizedStockTakeService.instance) {
      CentralizedStockTakeService.instance = new CentralizedStockTakeService();
    }
    return CentralizedStockTakeService.instance;
  }

  /**
   * Start a new stock take session using centralized FirestoreService
   */
  async startSession(
    orgId: string,
    userId: string,
    userName: string,
    deviceId: string = 'dashboard'
  ): Promise<string> {
    try {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Use centralized service to store session
      const sessionData: Omit<StockTakeSession, 'id'> = {
        organizationId: orgId,
        userId,
        userName,
        deviceId,
        status: 'ACTIVE',
        startTime: Date.now(),
        itemsScanned: 0,
        scannedItems: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Store in Firestore through service layer
      await firestoreService.createCustomDocument(
        orgId,
        'stockTakeSessions',
        sessionId,
        sessionData
      );

      // Also update RTDB for real-time monitoring
      if (database) {
        const deviceRef = ref(database, `activeStockTakeDevices/${orgId}/${deviceId}`);
        await set(deviceRef, {
          userId,
          userName,
          sessionId,
          status: 'ACTIVE',
          startTime: Date.now(),
          lastActivity: Date.now()
        });
      }

      this.activeSessionId = sessionId;
      console.log('✅ Centralized stock take session started:', sessionId);
      return sessionId;
    } catch (error) {
      console.error('❌ Error starting centralized stock take session:', error);
      throw new Error(`Failed to start stock take session: ${error}`);
    }
  }

  /**
   * End active stock take session
   */
  async endSession(orgId: string, sessionId: string): Promise<boolean> {
    try {
      // Update session in Firestore through service layer
      await firestoreService.updateCustomDocument(
        orgId,
        'stockTakeSessions',
        sessionId,
        {
          status: 'COMPLETED',
          endTime: Date.now(),
          updatedAt: new Date()
        }
      );

      // Clean up RTDB device entry
      if (database) {
        const session = await this.getSessionSummary(orgId, sessionId);
        if (session?.deviceId) {
          const deviceRef = ref(database, `activeStockTakeDevices/${orgId}/${session.deviceId}`);
          await remove(deviceRef);
        }
      }

      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }

      console.log('✅ Centralized stock take session ended:', sessionId);
      return true;
    } catch (error) {
      console.error('❌ Error ending centralized stock take session:', error);
      return false;
    }
  }

  /**
   * Get active session for current user using centralized service
   */
  async getActiveSession(orgId: string, userId: string): Promise<StockTakeSession | null> {
    try {
      // Use a simpler query approach while indexes are building
      const allSessions = await firestoreService.queryCustomDocuments<StockTakeSession>(
        orgId,
        'stockTakeSessions',
        [
          { field: 'userId', operator: '==', value: userId }
        ],
        'startTime',
        'desc',
        10 // Get more and filter in memory
      );

      // Filter for active sessions in memory
      const activeSessions = allSessions.filter(session => session.status === 'ACTIVE');
      return activeSessions.length > 0 ? activeSessions[0] : null;
    } catch (error) {
      console.error('❌ Error getting active session through centralized service:', error);
      
      // Fallback: try without compound query
      try {
        const allSessions = await firestoreService.queryCustomDocuments<StockTakeSession>(
          orgId,
          'stockTakeSessions',
          [],
          'startTime',
          'desc',
          20
        );

        // Filter in memory for user and active status
        const userActiveSessions = allSessions.filter(session => 
          session.userId === userId && session.status === 'ACTIVE'
        );
        return userActiveSessions.length > 0 ? userActiveSessions[0] : null;
      } catch (fallbackError) {
        console.error('❌ Fallback query also failed:', fallbackError);
        return null;
      }
    }
  }

  /**
   * Get session summary using centralized service
   */
  async getSessionSummary(orgId: string, sessionId: string): Promise<StockTakeSession | null> {
    try {
      return await firestoreService.getCustomDocument<StockTakeSession>(
        orgId,
        'stockTakeSessions',
        sessionId
      );
    } catch (error) {
      console.error('❌ Error getting session summary through centralized service:', error);
      return null;
    }
  }

  /**
   * Add scanned item to session using centralized service
   */
  async addScannedItem(
    orgId: string,
    sessionId: string,
    item: ScannedItem
  ): Promise<void> {
    try {
      const session = await this.getSessionSummary(orgId, sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const scannedItems = session.scannedItems || [];
      scannedItems.push(item);

      await firestoreService.updateCustomDocument(
        orgId,
        'stockTakeSessions',
        sessionId,
        {
          scannedItems,
          itemsScanned: scannedItems.length,
          updatedAt: new Date()
        }
      );

      console.log('✅ Scanned item added through centralized service');
    } catch (error) {
      console.error('❌ Error adding scanned item through centralized service:', error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time device monitoring (using RTDB for low latency)
   */
  subscribeToDeviceMonitoring(
    orgId: string,
    callback: (devices: Record<string, any>) => void
  ): () => void {
    if (!database) return () => {};

    const devicesRef = ref(database, `activeStockTakeDevices/${orgId}`);
    
    const unsubscribe = onValue(devicesRef, (snapshot) => {
      const devices = snapshot.val() || {};
      callback(devices);
    });

    return unsubscribe;
  }

  /**
   * Subscribe to approval requests (using RTDB for real-time updates)
   */
  subscribeToApprovals(
    orgId: string,
    callback: (approvals: Record<string, any>) => void
  ): () => void {
    if (!database) return () => {};

    const approvalsRef = ref(database, `stockTakeApprovals/${orgId}`);
    
    const unsubscribe = onValue(approvalsRef, (snapshot) => {
      const approvals = snapshot.val() || {};
      callback(approvals);
    });

    return unsubscribe;
  }

  /**
   * Get all stock take sessions for organization
   */
  async getAllSessions(
    orgId: string,
    status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED',
    limit: number = 50
  ): Promise<StockTakeSession[]> {
    try {
      if (status) {
        // Try compound query first
        try {
          return await firestoreService.queryCustomDocuments<StockTakeSession>(
            orgId,
            'stockTakeSessions',
            [
              { field: 'status', operator: '==', value: status }
            ],
            'startTime',
            'desc',
            limit
          );
        } catch (indexError) {
          console.warn('⚠️ Compound query failed, using fallback approach:', indexError);
          
          // Fallback: get all and filter in memory
          const allSessions = await firestoreService.queryCustomDocuments<StockTakeSession>(
            orgId,
            'stockTakeSessions',
            [],
            'startTime',
            'desc',
            Math.max(limit * 2, 100) // Get more to filter
          );

          return allSessions
            .filter(session => session.status === status)
            .slice(0, limit);
        }
      } else {
        return await firestoreService.queryCustomDocuments<StockTakeSession>(
          orgId,
          'stockTakeSessions',
          [],
          'startTime',
          'desc',
          limit
        );
      }
    } catch (error) {
      console.error('❌ Error getting all sessions through centralized service:', error);
      return [];
    }
  }

  /**
   * Archive old completed sessions
   */
  async archiveOldSessions(orgId: string, olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      
      const oldSessions = await firestoreService.queryCustomDocuments<StockTakeSession>(
        orgId,
        'stockTakeSessions',
        [
          { field: 'status', operator: '==', value: 'COMPLETED' },
          { field: 'endTime', operator: '<=', value: cutoffTime }
        ]
      );

      let archivedCount = 0;
      for (const session of oldSessions) {
        // Move to archived collection
        await firestoreService.createCustomDocument(
          orgId,
          'archivedStockTakeSessions',
          session.id,
          session
        );

        // Remove from active collection
        await firestoreService.deleteCustomDocument(
          orgId,
          'stockTakeSessions',
          session.id
        );

        archivedCount++;
      }

      console.log(`✅ Archived ${archivedCount} old stock take sessions`);
      return archivedCount;
    } catch (error) {
      console.error('❌ Error archiving old sessions:', error);
      return 0;
    }
  }
}

export const centralizedStockTakeService = CentralizedStockTakeService.getInstance();
export default centralizedStockTakeService;
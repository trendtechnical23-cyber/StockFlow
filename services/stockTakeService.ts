/**
 * Stock Take Service (Firestore-only)
 * 
 * Handles stock take sessions without Realtime Database
 * Uses Firestore for session management and syncing
 */

import { 
  firestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot
} from './firebase';

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

class StockTakeService {
  private static instance: StockTakeService;
  private activeSessionId: string | null = null;

  static getInstance(): StockTakeService {
    if (!StockTakeService.instance) {
      StockTakeService.instance = new StockTakeService();
    }
    return StockTakeService.instance;
  }

  /**
   * Start a new stock take session
   */
  async startSession(
    orgId: string,
    userId: string,
    userName: string,
    deviceId: string = 'dashboard'
  ): Promise<string> {
    if (!firestore) throw new Error('Firestore not initialized');

    try {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const sessionRef = doc(firestore, 'organizations', orgId, 'stockTakeSessions', sessionId);

      const session: Omit<StockTakeSession, 'id'> = {
        organizationId: orgId,
        userId,
        userName,
        deviceId,
        status: 'ACTIVE',
        startTime: Date.now(),
        itemsScanned: 0,
        scannedItems: []
      };

      await setDoc(sessionRef, {
        ...session,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      this.activeSessionId = sessionId;
      console.log('✅ Stock take session started:', sessionId);
      return sessionId;
    } catch (error) {
      console.error('❌ Error starting stock take session:', error);
      throw error;
    }
  }

  /**
   * End active stock take session
   */
  async endSession(orgId: string, sessionId: string): Promise<boolean> {
    if (!firestore) throw new Error('Firestore not initialized');

    try {
      const sessionRef = doc(firestore, 'organizations', orgId, 'stockTakeSessions', sessionId);
      
      await updateDoc(sessionRef, {
        status: 'COMPLETED',
        endTime: Date.now(),
        updatedAt: serverTimestamp()
      });

      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }

      console.log('✅ Stock take session ended:', sessionId);
      return true;
    } catch (error) {
      console.error('❌ Error ending stock take session:', error);
      return false;
    }
  }

  /**
   * Approve a stock take session (Firestore) - marks as approved and deletes from pending
   */
  async approveSession(orgId: string, sessionId: string): Promise<boolean> {
    if (!firestore) throw new Error('Firestore not initialized');
    try {
      const sessionRef = doc(firestore, 'organizations', orgId, 'stockTakeSessions', sessionId);
      
      // Mark as approved before deleting
      await updateDoc(sessionRef, {
        status: 'APPROVED',
        approvedAt: Date.now(),
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ APK session approved:', sessionId);
      return true;
    } catch (error) {
      console.error('❌ Error approving APK session:', error);
      return false;
    }
  }

  /**
   * Reject a stock take session (Firestore) - marks as rejected and deletes from pending
   */
  async rejectSession(orgId: string, sessionId: string): Promise<boolean> {
    if (!firestore) throw new Error('Firestore not initialized');
    try {
      const sessionRef = doc(firestore, 'organizations', orgId, 'stockTakeSessions', sessionId);
      
      // Mark as rejected before deleting
      await updateDoc(sessionRef, {
        status: 'REJECTED',
        rejectedAt: Date.now(),
        updatedAt: serverTimestamp()
      });
      
      console.log('❌ APK session rejected:', sessionId);
      return true;
    } catch (error) {
      console.error('❌ Error rejecting APK session:', error);
      return false;
    }
  }

  /**
   * Get active session for current user
   */
  async getActiveSession(orgId: string, userId: string): Promise<StockTakeSession | null> {
    if (!firestore) return null;

    try {
      const sessionsRef = collection(firestore, 'organizations', orgId, 'stockTakeSessions');
      const q = query(
        sessionsRef,
        where('userId', '==', userId),
        where('status', '==', 'ACTIVE'),
        orderBy('startTime', 'desc')
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;

      const doc = snapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data()
      } as StockTakeSession;
    } catch (error) {
      console.error('❌ Error getting active session:', error);
      return null;
    }
  }

  /**
   * Get session summary
   */
  async getSessionSummary(orgId: string, sessionId: string): Promise<StockTakeSession | null> {
    if (!firestore) return null;

    try {
      const sessionRef = doc(firestore, 'organizations', orgId, 'stockTakeSessions', sessionId);
      const snapshot = await getDoc(sessionRef);

      if (!snapshot.exists()) return null;

      return {
        id: snapshot.id,
        ...snapshot.data()
      } as StockTakeSession;
    } catch (error) {
      console.error('❌ Error getting session summary:', error);
      return null;
    }
  }

  /**
   * Subscribe to whether ANY active session exists in the org (for sidebar indicator)
   */
  subscribeToAnyActiveSession(
    orgId: string,
    callback: (hasActive: boolean) => void
  ): () => void {
    if (!firestore) return () => {};

    const sessionsRef = collection(firestore, 'organizations', orgId, 'stockTakeSessions');
    const q = query(sessionsRef, where('status', '==', 'ACTIVE'));

    return onSnapshot(q, (snapshot) => {
      callback(!snapshot.empty);
    }, () => {
      callback(false);
    });
  }

  /**
   * Listen to active session changes
   */
  subscribeToActiveSession(
    orgId: string,
    userId: string,
    callback: (session: StockTakeSession | null) => void
  ): () => void {
    if (!firestore) return () => {};

    const sessionsRef = collection(firestore, 'organizations', orgId, 'stockTakeSessions');
    const q = query(
      sessionsRef,
      where('userId', '==', userId),
      where('status', '==', 'ACTIVE')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        callback(null);
        return;
      }

      const doc = snapshot.docs[0];
      callback({
        id: doc.id,
        ...doc.data()
      } as StockTakeSession);
    });

    return unsubscribe;
  }

  /**
   * Add scanned item to session
   */
  async addScannedItem(
    orgId: string,
    sessionId: string,
    item: ScannedItem
  ): Promise<void> {
    if (!firestore) throw new Error('Firestore not initialized');

    try {
      const sessionRef = doc(firestore, 'organizations', orgId, 'stockTakeSessions', sessionId);
      const sessionSnap = await getDoc(sessionRef);

      if (!sessionSnap.exists()) {
        throw new Error('Session not found');
      }

      const session = sessionSnap.data() as Omit<StockTakeSession, 'id'>;
      const scannedItems = session.scannedItems || [];
      scannedItems.push(item);

      await updateDoc(sessionRef, {
        scannedItems,
        itemsScanned: scannedItems.length,
        updatedAt: serverTimestamp()
      });

      console.log('✅ Scanned item added to session');
    } catch (error) {
      console.error('❌ Error adding scanned item:', error);
      throw error;
    }
  }

  /**
   * Get all sessions (including completed ones) for debugging/monitoring
   */
  async getAllSessions(orgId: string): Promise<StockTakeSession[]> {
    if (!firestore) throw new Error('Firestore not initialized');

    try {
      const sessionsRef = collection(firestore, 'organizations', orgId, 'stockTakeSessions');
      const q = query(sessionsRef, orderBy('startTime', 'desc'));
      const snapshot = await getDocs(q);

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as StockTakeSession[];
    } catch (error) {
      console.error('❌ Error getting all sessions:', error);
      throw error;
    }
  }

  /**
   * Subscribe to all sessions (for monitoring)
   */
  subscribeToAllSessions(
    orgId: string,
    callback: (sessions: StockTakeSession[]) => void
  ): () => void {
    if (!firestore) return () => {};

    console.log('🔍 DEBUGGING: Subscribing to sessions');
    console.log('🔍 Organization ID:', orgId);
    console.log('🔍 Firestore path: organizations/' + orgId + '/stockTakeSessions');

    const sessionsRef = collection(firestore, 'organizations', orgId, 'stockTakeSessions');
    const q = query(sessionsRef, orderBy('startTime', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log('🔍 Raw Firestore snapshot size:', snapshot.size);
      console.log('🔍 Snapshot empty?', snapshot.empty);
      
      const sessions = snapshot.docs.map(doc => {
        const data = doc.data();
        console.log('🔍 Found session:', doc.id, data);
        return {
          id: doc.id,
          ...data
        };
      }) as StockTakeSession[];
      
      console.log('📋 Stock take sessions updated:', sessions.length, 'total sessions');
      console.log('📋 All sessions:', sessions);
      callback(sessions);
    }, (error) => {
      console.error('❌ Error in sessions subscription:', error);
      console.error('❌ Error details:', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
    });

    return unsubscribe;
  }
}

export const stockTakeService = StockTakeService.getInstance();
export default stockTakeService;

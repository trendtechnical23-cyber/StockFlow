/**
 * Live Scan Service
 *
 * Self-contained singleton. Pass orgId once — it subscribes to all ACTIVE
 * stockTakeSessions in Firestore and dynamically manages per-session scan
 * listeners. State persists across navigation as long as at least one
 * subscriber is attached.
 *
 * Firestore paths:
 *   organizations/{orgId}/stockTakeSessions  (query: status == 'ACTIVE')
 *   organizations/{orgId}/stockTakeSessions/{sessionId}/scans
 */

import { firestore } from './firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

export interface LiveScanEvent {
  itemId: string;
  itemName: string;
  sku: string;
  scannedQuantity: number;
  deviceId: string;
  userName: string;
  userId: string;
  scannedAt: any;
}

export interface LiveScanState {
  scans: LiveScanEvent[];
  skuCounts: Map<string, number>;
  userScanCounts: Map<string, number>;
  duplicateSkus: Set<string>;
}

type Callback = (states: Map<string, LiveScanState>) => void;

class LiveScanService {
  private static _instance: LiveScanService;
  private orgId: string | null = null;
  private currentState = new Map<string, LiveScanState>();
  private sessionUnsubs = new Map<string, () => void>();
  private orgUnsub: (() => void) | null = null;
  private callbacks = new Set<Callback>();

  static getInstance(): LiveScanService {
    if (!LiveScanService._instance) {
      LiveScanService._instance = new LiveScanService();
    }
    return LiveScanService._instance;
  }

  /**
   * Subscribe to live scans for an org. Pass only orgId.
   * Returns unsubscribe function. Call when component unmounts.
   * State is preserved across re-subscriptions for the same orgId.
   */
  subscribeToOrg(orgId: string, callback: Callback): () => void {
    this.callbacks.add(callback);

    if (this.orgId === orgId) {
      // Already watching this org — send current state immediately
      callback(new Map(this.currentState));
    } else {
      // Different org or first call — start fresh
      this._teardown();
      this.orgId = orgId;
      this._startOrgListener(orgId);
    }

    return () => {
      this.callbacks.delete(callback);
      // Stop Firestore reads when no one is listening
      if (this.callbacks.size === 0) {
        this._teardown();
      }
    };
  }

  private _startOrgListener(orgId: string) {
    if (!firestore) return;

    const sessionsRef = collection(firestore, 'organizations', orgId, 'stockTakeSessions');
    const q = query(sessionsRef, where('status', '==', 'ACTIVE'));

    this.orgUnsub = onSnapshot(q, (snapshot) => {
      const liveIds = new Set(snapshot.docs.map(d => d.id));

      // Remove listeners for sessions that are no longer ACTIVE
      this.sessionUnsubs.forEach((unsub, id) => {
        if (!liveIds.has(id)) {
          unsub();
          this.sessionUnsubs.delete(id);
          this.currentState.delete(id);
        }
      });

      // Add listeners for newly ACTIVE sessions
      snapshot.docs.forEach(doc => {
        if (!this.sessionUnsubs.has(doc.id)) {
          this._subscribeToScans(orgId, doc.id);
        }
      });

      // Notify immediately if no sessions (clears the panel)
      if (liveIds.size === 0) {
        this._notify();
      }
    }, () => {});
  }

  private _subscribeToScans(orgId: string, sessionId: string) {
    if (!firestore) return;

    const scansRef = collection(
      firestore, 'organizations', orgId, 'stockTakeSessions', sessionId, 'scans'
    );

    const unsub = onSnapshot(scansRef, (snapshot) => {
      const scans: LiveScanEvent[] = [];
      const skuCounts = new Map<string, number>();
      const userScanCounts = new Map<string, number>();
      const devicePerSku = new Map<string, Set<string>>();
      const duplicateSkus = new Set<string>();

      snapshot.forEach(doc => {
        const data = doc.data() as LiveScanEvent;
        scans.push(data);
        skuCounts.set(data.sku, (skuCounts.get(data.sku) || 0) + 1);
        userScanCounts.set(data.userName, (userScanCounts.get(data.userName) || 0) + 1);
        if (!devicePerSku.has(data.sku)) devicePerSku.set(data.sku, new Set());
        devicePerSku.get(data.sku)!.add(data.deviceId);
      });

      devicePerSku.forEach((devices, sku) => {
        if (devices.size > 1) duplicateSkus.add(sku);
      });

      scans.sort((a, b) => {
        const aTime = a.scannedAt?.toMillis?.() ?? (a.scannedAt || 0);
        const bTime = b.scannedAt?.toMillis?.() ?? (b.scannedAt || 0);
        return bTime - aTime;
      });

      this.currentState.set(sessionId, { scans, skuCounts, userScanCounts, duplicateSkus });
      this._notify();
    }, () => {});

    this.sessionUnsubs.set(sessionId, unsub);
  }

  private _notify() {
    const snapshot = new Map(this.currentState);
    this.callbacks.forEach(cb => cb(snapshot));
  }

  private _teardown() {
    this.orgUnsub?.();
    this.orgUnsub = null;
    this.sessionUnsubs.forEach(u => u());
    this.sessionUnsubs.clear();
    this.currentState.clear();
    this.orgId = null;
  }
}

export default LiveScanService.getInstance();

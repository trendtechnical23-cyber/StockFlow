/**
 * Firebase compatibility shim — Firebase has been fully removed.
 *
 * The Firebase project was deleted during the migration to Supabase. This file
 * NO LONGER initializes Firebase or connects to any Firebase backend. It exists
 * only so the ~dozen files that still `import { ... } from './firebase'` keep
 * compiling. Every data operation re-exported here is a throwing stub: callers
 * that still use them fail with a CATCHABLE error (handled by their own
 * try/catch) instead of silently talking to a dead backend.
 *
 * Migrate remaining callers to `./supabase` and then delete these imports.
 */

// Auth/DB handles are intentionally null — guards like `if (!firestore)` short-circuit.
export const auth: any = null;
export const firestore: any = null;
export const db: any = null;          // alias used by purchase-order services
export const database: any = null;
export const storage: any = null;
export const analytics: any = null;

export const isFirebaseConfigured = false;
export const isFirebaseInitialized = () => false;

const removed = (): never => {
  throw new Error('Firebase has been removed — migrate this call to Supabase (services/supabase.ts)');
};

// Firestore primitives
export const doc: any = removed;
export const collection: any = removed;
export const query: any = removed;
export const where: any = removed;
export const orderBy: any = removed;
export const limit: any = removed;
export const getDocs: any = removed;
export const getDoc: any = removed;
export const setDoc: any = removed;
export const updateDoc: any = removed;
export const deleteDoc: any = removed;
export const addDoc: any = removed;
export const writeBatch: any = removed;
export const onSnapshot: any = removed;

// Value helpers that must return something usable
export const serverTimestamp = () => new Date().toISOString();
export const arrayUnion = (...items: any[]) => items;
export const arrayRemove = (...items: any[]) => items;

// Realtime Database primitives (also removed)
export const ref: any = removed;
export const onValue: any = removed;
export const off: any = removed;
export const update: any = removed;
export const set: any = removed;
export const remove: any = removed;
export const get: any = removed;

/**
 * Legacy data-access class. Superseded by the OrganizationDataService in
 * services/supabase.ts (which apiService imports). Kept here only for any
 * lingering `import { OrganizationDataService } from './firebase'` references;
 * its data methods now throw so they can't silently hit a dead backend.
 */
export class OrganizationDataService {
  private static instance: OrganizationDataService;
  static getInstance(): OrganizationDataService {
    if (!OrganizationDataService.instance) {
      OrganizationDataService.instance = new OrganizationDataService();
    }
    return OrganizationDataService.instance;
  }

  async clearLocalData() {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('appSettings_') || key.includes('inventory_') || key.includes('logs_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch (error) {
      console.error('❌ Error clearing local data:', error);
    }
  }

  getOrgCollection(): never { return removed(); }
  getOrgDoc(): never { return removed(); }
  async createOrganization(): Promise<never> { return removed(); }
  async getOrganizationData(): Promise<never> { return removed(); }
  async getAllOrganizationData(): Promise<never> { return removed(); }
}

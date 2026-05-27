/**
 * Firebase compatibility stub — Firebase has been fully removed.
 *
 * This file is aliased to every `firebase/*` import via vite.config.ts and
 * tsconfig.json paths. Nothing here touches the Firebase SDK; all exports are
 * safe no-ops or throwing stubs so the rest of the codebase compiles and fails
 * gracefully at runtime instead of at import time.
 *
 * To migrate a caller: replace Firebase SDK calls with Supabase equivalents
 * using `services/supabase.ts`, then remove the import entirely.
 */

// ── Auth / DB handles ─────────────────────────────────────────────────────────
export const auth: any = null;
export const firestore: any = null;
export const db: any = null;
export const rtdb: any = null;
export const database: any = null;
export const storage: any = null;
export const analytics: any = null;
export const messaging: any = null;

export const isFirebaseConfigured = false;
export const isFirebaseInitialized = () => false;

// ── Stub factory ──────────────────────────────────────────────────────────────
const removed = (..._args: any[]): never => {
  throw new Error(
    'Firebase has been removed — migrate this call to Supabase (services/supabase.ts)'
  );
};

// ── Firestore CRUD primitives ─────────────────────────────────────────────────
export const doc: any          = removed;
export const collection: any   = removed;
export const query: any        = removed;
export const where: any        = removed;
export const orderBy: any      = removed;
export const limit: any        = removed;
export const startAfter: any   = removed;
export const getDocs: any      = removed;
export const getDoc: any       = removed;
export const setDoc: any       = removed;
export const updateDoc: any    = removed;
export const deleteDoc: any    = removed;
export const addDoc: any       = removed;
export const writeBatch: any   = removed;
export const onSnapshot: any   = removed;
export const increment: any    = removed;
export const arrayUnion        = (...items: any[]) => items;
export const arrayRemove       = (...items: any[]) => items;
export const serverTimestamp   = () => new Date().toISOString();

// ── Realtime Database primitives ──────────────────────────────────────────────
export const ref: any      = removed;
export const onValue: any  = removed;
export const off: any      = removed;
export const update: any   = removed;
export const set: any      = removed;
export const remove: any   = removed;
export const get: any      = removed;
export const push: any     = removed;
export const getDatabase: any = removed;
export const child: any    = removed;

// ── App primitives ────────────────────────────────────────────────────────────
export const initializeApp: any = removed;
export const getApp: any        = () => null;
export const getApps: any       = () => [];

// ── Auth primitives ───────────────────────────────────────────────────────────
export const signInWithEmailAndPassword: any = removed;
export const createUserWithEmailAndPassword: any = removed;
export const signOut: any = removed;
export const onAuthStateChanged: any = removed;
export const getAuth: any = () => null;
export const GoogleAuthProvider: any = class {};
export const signInWithPopup: any = removed;

// ── Timestamp (used as a type and value in some services) ─────────────────────
export class Timestamp {
  seconds: number;
  nanoseconds: number;
  constructor(seconds = 0, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  toDate() { return new Date(this.seconds * 1000); }
  toMillis() { return this.seconds * 1000; }
  static now() { return new Timestamp(Math.floor(Date.now() / 1000), 0); }
  static fromDate(d: Date) { return new Timestamp(Math.floor(d.getTime() / 1000), 0); }
  static fromMillis(ms: number) { return new Timestamp(Math.floor(ms / 1000), 0); }
}

// ── FieldValue ────────────────────────────────────────────────────────────────
export const FieldValue = {
  serverTimestamp: () => new Date().toISOString(),
  increment: (n: number) => n,
  arrayUnion: (...items: any[]) => items,
  arrayRemove: (...items: any[]) => items,
  delete: () => undefined,
};

// ── TypeScript type aliases (no runtime values needed) ────────────────────────
export type Query            = any;
export type DocumentData     = Record<string, any>;
export type QueryConstraint  = any;
export type DocumentSnapshot = any;
export type CollectionReference = any;
export type DocumentReference   = any;
export type Unsubscribe         = () => void;

/**
 * Legacy data-access class — kept for any lingering imports.
 * All data methods throw so they can't silently hit a dead backend.
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

  getOrgCollection(): never  { return removed(); }
  getOrgDoc(): never         { return removed(); }
  async createOrganization(): Promise<never>    { return removed(); }
  async getOrganizationData(): Promise<never>   { return removed(); }
  async getAllOrganizationData(): Promise<never> { return removed(); }
}

// ── Messaging ─────────────────────────────────────────────────────────────────
export const getMessaging: any  = () => null;
export const getToken: any      = removed;
export const onMessage: any     = removed;
export const isSupported: any   = async () => false;

// ── Storage ───────────────────────────────────────────────────────────────────
export const getStorage: any     = () => null;
export const uploadBytes: any    = removed;
export const getDownloadURL: any = removed;

// ── Config ────────────────────────────────────────────────────────────────────
export const firebaseConfig: Record<string, string> = {};

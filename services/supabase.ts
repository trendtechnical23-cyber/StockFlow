/**
 * Supabase client — replaces services/firebase.ts
 *
 * Auth:     Supabase Auth (replaces Firebase Auth)
 * Database: Supabase PostgreSQL with RLS (replaces Firestore)
 * FCM:      Firebase Cloud Messaging kept separately in firebaseMessaging.ts
 */
import { createClient, RealtimeChannel } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,   // handles magic-link / invite redirects
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// ── Auth helpers ──────────────────────────────────────────────────────────────

export const signIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password });

export const signUp = (email: string, password: string, meta?: Record<string, unknown>) =>
  supabase.auth.signUp({ email, password, options: { data: meta } });

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

export const getUser = () => supabase.auth.getUser();

/** Listen to auth state changes — drop-in replacement for onAuthStateChanged */
export const onAuthStateChange = (
  callback: (event: string, session: any) => void
) => supabase.auth.onAuthStateChange(callback);

// ── Organization Data Service ─────────────────────────────────────────────────

export class OrganizationDataService {
  private static instance: OrganizationDataService;

  static getInstance(): OrganizationDataService {
    if (!OrganizationDataService.instance) {
      OrganizationDataService.instance = new OrganizationDataService();
    }
    return OrganizationDataService.instance;
  }

  /** Clear local cache on org switch */
  async clearLocalData() {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('appSettings_') || key.includes('inventory_') || key.includes('logs_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
    console.log('🧹 Local data cleared');
  }

  /** Create organization + owner user in a single transaction via RPC */
  async createOrganization(organizationData: any, adminUserData: any) {
    const { data, error } = await supabase.rpc('create_organization_with_owner', {
      p_org_id:       organizationData.id,
      p_org_name:     organizationData.name,
      p_org_plan:     organizationData.plan ?? 'free',
      p_user_id:      adminUserData.uid,
      p_user_email:   adminUserData.email,
      p_user_name:    adminUserData.displayName ?? adminUserData.email,
    });

    if (error) {
      console.error('❌ createOrganization failed:', error);
      throw error;
    }
    console.log(`✅ Organization '${organizationData.name}' created`);
    return { success: true, organizationId: organizationData.id };
  }

  /** Fetch org + user row — used on login to hydrate AppContext */
  async getOrganizationData(organizationId: string, userId: string) {
    const [orgResult, userResult] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', organizationId).single(),
      supabase.from('users').select('*').eq('id', userId).single(),
    ]);

    if (orgResult.error)  throw orgResult.error;
    if (userResult.error) throw userResult.error;

    return {
      organization: orgResult.data,
      user:         userResult.data,
    };
  }

  /** Bulk load of org data on startup — replaces getAllOrganizationData */
  async getAllOrganizationData(organizationId: string) {
    const [inventoryResult, usersResult, logsResult] = await Promise.all([
      supabase
        .from('inventory_items')
        .select('*')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('users')
        .select('*')
        .eq('org_id', organizationId)
        .eq('is_active', true),
      supabase
        .from('activity_logs')
        .select('*')
        .eq('org_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    return {
      inventory:    inventoryResult.data  ?? [],
      users:        usersResult.data      ?? [],
      activityLogs: logsResult.data       ?? [],
    };
  }
}

// ── Real-time helpers ─────────────────────────────────────────────────────────

/**
 * Subscribe to live changes on inventory_items for an org.
 * Returns the channel so the caller can call .unsubscribe() on cleanup.
 */
export const subscribeToInventory = (
  orgId: string,
  onChange: (payload: any) => void
): RealtimeChannel =>
  supabase
    .channel(`inventory:${orgId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_items', filter: `org_id=eq.${orgId}` },
      onChange
    )
    .subscribe();

export const subscribeToUsers = (
  orgId: string,
  onChange: (payload: any) => void
): RealtimeChannel =>
  supabase
    .channel(`users:${orgId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'users', filter: `org_id=eq.${orgId}` },
      onChange
    )
    .subscribe();

export const subscribeToActivityLogs = (
  orgId: string,
  onChange: (payload: any) => void
): RealtimeChannel =>
  supabase
    .channel(`activity_logs:${orgId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `org_id=eq.${orgId}` },
      onChange
    )
    .subscribe();

// ── Legacy compatibility shims ────────────────────────────────────────────────
// These allow files that import named exports from firebase.ts to keep working
// during the migration without needing a simultaneous rewrite of every file.

export const auth = {
  signOut: signOut,
  onAuthStateChanged: (cb: (user: any) => void) => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      cb(session?.user ?? null);
    });
    return data.subscription.unsubscribe;
  },
};

// Firestore-style helpers mapped to Supabase queries
// Used by files that still call the old firebase.ts named exports
export const serverTimestamp = () => new Date().toISOString();

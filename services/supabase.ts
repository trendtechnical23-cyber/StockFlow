/**
 * Supabase client — frontend singleton
 *
 * Auth:      Supabase Auth (GoTrue)
 * Database:  Supabase PostgreSQL with RLS
 * Realtime:  postgres_changes + Presence + Broadcast
 *
 * SDK reference: supabase-js/packages/core/supabase-js
 */
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import type { SupabaseClient, Session } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars');
}

// ── Main singleton client ─────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: true,  // handles magic-link / invite redirects
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// ── Token cache ───────────────────────────────────────────────────────────────
// Per the SDK source (GoTrueClient.ts), calling getSession() on every API
// request acquires an exclusive internal lock. Under heavy realtime activity
// this causes noticeable latency spikes. Instead we cache the token from
// auth events so getAccessToken() is always O(1) and never blocks.

let _cachedToken: string | null = null;

/** Initialise the token cache by subscribing to auth events.
 *  Call once at app startup (App.tsx already runs onAuthStateChange — this
 *  cache is a separate, lightweight listener that never touches state). */
export function initTokenCache(): () => void {
  // Pre-populate from current session (synchronous fast-path)
  supabase.auth.getSession().then(({ data: { session } }) => {
    _cachedToken = session?.access_token ?? null;
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      _cachedToken = session?.access_token ?? null;
    }
    if (event === 'SIGNED_OUT') {
      _cachedToken = null;
    }
  });

  return () => subscription.unsubscribe();
}

/**
 * Returns the current JWT access token for authenticating Railway API calls.
 *
 * Uses the in-memory cache populated by initTokenCache() — O(1), no lock.
 * Falls back to getSession() if the cache is empty (e.g. before first event).
 */
export const getAccessToken = async (): Promise<string | null> => {
  if (_cachedToken) return _cachedToken;
  // Cold start / cache not yet warmed — fetch once and cache
  const { data: { session } } = await supabase.auth.getSession();
  _cachedToken = session?.access_token ?? null;
  return _cachedToken;
};

// ── Per-request user client (for server-side use) ─────────────────────────────
// Pattern from SDK docs: pass an `accessToken` callback so the client never
// calls getSession() itself — it uses whatever token you supply, enabling
// RLS-enforced queries on behalf of the logged-in user.

export const createUserClient = (accessToken: string): SupabaseClient =>
  createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
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

/** Listen to auth state changes */
export const onAuthStateChange = (
  callback: (event: string, session: Session | null) => void
) => supabase.auth.onAuthStateChange(callback);

// ── Realtime channel factory ──────────────────────────────────────────────────
// Rule from SDK source (RealtimeChannel.ts):
//   ALL .on() calls MUST precede .subscribe().
//   Calling .on() after .subscribe() throws "cannot add postgres_changes
//   callbacks after subscribe()".
// → Always chain .on() calls before calling .subscribe().

export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

export interface ChannelOptions {
  onStatus?: (status: ChannelStatus) => void;
}

/**
 * Create a named channel with an optional status callback.
 * Returns the channel for caller to chain .on() before calling .subscribe().
 *
 * @example
 * const ch = makeChannel('inventory:orgId')
 *   .on('postgres_changes', { ... }, handler)
 *   .subscribe();
 */
export const makeChannel = (name: string, opts?: ChannelOptions): RealtimeChannel => {
  const ch = supabase.channel(name);
  if (opts?.onStatus) {
    // We attach the status listener in subscribe() — store it for the caller
    (ch as any).__statusCb = opts.onStatus;
  }
  return ch;
};

// ── Presence helpers ──────────────────────────────────────────────────────────
// Supabase Presence lets clients track who is online.
// SDK source: RealtimeChannel.ts → track() / untrack()

export interface PresenceMeta {
  userId: string;
  name?: string;
  avatarUrl?: string;
  [key: string]: unknown;
}

/**
 * Track the current user's presence on a channel.
 * Call AFTER .subscribe() fires 'SUBSCRIBED'.
 */
export const trackPresence = (channel: RealtimeChannel, meta: PresenceMeta) =>
  channel.track(meta);

/** Stop tracking presence (keep channel open). */
export const untrackPresence = (channel: RealtimeChannel) =>
  channel.untrack();

/**
 * Subscribe to presence JOIN/LEAVE events.
 * Must be called BEFORE .subscribe().
 *
 * @example
 * const ch = supabase.channel('room:orgId')
 *   .on('presence', { event: 'sync' }, () => console.log(ch.presenceState()))
 *   .on('presence', { event: 'join' }, ({ newPresences }) => { ... })
 *   .on('presence', { event: 'leave' }, ({ leftPresences }) => { ... })
 *   .subscribe(...)
 */
export const onPresenceSync = (
  channel: RealtimeChannel,
  onSync: () => void,
  onJoin?: (presences: PresenceMeta[]) => void,
  onLeave?: (presences: PresenceMeta[]) => void
): RealtimeChannel =>
  channel
    .on('presence', { event: 'sync' } as any, onSync)
    .on('presence', { event: 'join' } as any, ({ newPresences }: any) => onJoin?.(newPresences))
    .on('presence', { event: 'leave' } as any, ({ leftPresences }: any) => onLeave?.(leftPresences));

// ── Broadcast helpers ─────────────────────────────────────────────────────────
// Broadcast is client-to-client messaging without touching the database.
// Use for ephemeral UI events: cursor positions, typing indicators, etc.

export const sendBroadcast = (
  channel: RealtimeChannel,
  event: string,
  payload: Record<string, unknown>
) =>
  channel.send({
    type: 'broadcast',
    event,
    payload,
  });

export const onBroadcast = (
  channel: RealtimeChannel,
  event: string,
  handler: (payload: Record<string, unknown>) => void
): RealtimeChannel =>
  channel.on('broadcast', { event } as any, ({ payload }: any) => handler(payload));

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

  /** Create organization + owner user via RPC (v3 schema: rpc_create_org_with_owner) */
  async createOrganization(organizationData: any, adminUserData: any) {
    const { data, error } = await supabase.rpc('rpc_create_org_with_owner', {
      p_org_id:     organizationData.id,
      p_org_name:   organizationData.name,
      p_org_plan:   organizationData.plan ?? 'free',
      p_user_id:    adminUserData.uid,
      p_user_email: adminUserData.email,
      p_user_name:  adminUserData.displayName ?? adminUserData.email,
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
    const [orgResult, userResult, settingsResult] = await Promise.all([
      supabase.from('organizations').select('id, name, subscription_plan, status, integrations, created_at, updated_at').eq('id', organizationId).single(),
      // v3 schema: role column renamed to legacy_role
      supabase.from('users').select('id, org_id, email, full_name, legacy_role, status, created_at').eq('id', userId).single(),
      supabase.from('organization_settings').select('*').eq('org_id', organizationId).maybeSingle(),
    ]);

    if (orgResult.error)  throw orgResult.error;
    if (userResult.error) throw userResult.error;

    // Normalise user row: expose legacy_role as 'role' so existing AppContext code works
    const user = userResult.data ? { ...userResult.data, role: userResult.data.legacy_role } : null;
    const org  = orgResult.data  ? { ...orgResult.data,  plan: orgResult.data.subscription_plan, settings: settingsResult.data ?? {} } : null;

    return { organization: org, user };
  }

  /** Bulk load of org data on startup */
  async getAllOrganizationData(organizationId: string) {
    // v3 schema: inventory_items has NO quantity column.
    // Stock levels come from rpc_get_org_stock_summary (joins inventory_balances).
    // We fetch both in parallel and merge.

    const [stockSummaryResult, usersResult, logsResult] = await Promise.all([
      // Returns items with current_stock from inventory_balances
      supabase.rpc('rpc_get_org_stock_summary', { p_org_id: organizationId }),
      // v3: filter by status = 'active' (not is_active boolean — that column is on items, not users)
      supabase
        .from('users')
        .select('id, org_id, email, full_name, legacy_role, status, created_at')
        .eq('org_id', organizationId)
        .eq('status', 'active'),
      supabase
        .from('activity_logs')
        .select('id, org_id, user_id, action, entity_type, entity_id, details, created_at')
        .eq('org_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    // Map rpc_get_org_stock_summary rows to the shape AppContext expects
    const inventory = (stockSummaryResult.data ?? []).map((row: any) => ({
      id:            row.item_id,
      org_id:        organizationId,
      sku:           row.sku,
      name:          row.name,
      // Expose stock as both 'stock' (legacy) and 'quantity' (v1 compat)
      stock:         Number(row.current_stock ?? 0),
      quantity:      Number(row.current_stock ?? 0),
      threshold:     row.minimum_stock ?? 0,
      min_quantity:  row.minimum_stock ?? 0,
      reorder_point: row.reorder_point ?? null,
      unit_price:    row.unit_price    ?? null,
      unit_cost:     row.unit_cost     ?? null,
      is_active:     true,
      is_priority:   row.is_priority   ?? false,
      is_low_stock:  row.is_low_stock  ?? false,
      is_out_of_stock: row.is_out_of_stock ?? false,
      category_id:   row.category_id   ?? null,
      // Fields from the inventory_items table will be null here — fetch full details
      // via ItemDetailView which queries inventory_items directly.
    }));

    // Normalise users: expose legacy_role as 'role' for AppContext compat
    const users = (usersResult.data ?? []).map((u: any) => ({
      ...u,
      role: u.legacy_role,
    }));

    console.log(`✅ Loaded ${inventory.length} items for org ${organizationId}`);

    return {
      inventory,
      users,
      activityLogs: logsResult.data ?? [],
    };
  }
}

// ── Legacy realtime helpers ───────────────────────────────────────────────────
// Kept for any components that still use these directly.
// AppContext uses the merged-channel pattern instead.

export const subscribeToInventory = (
  orgId: string,
  onChange: (payload: any) => void
): RealtimeChannel =>
  supabase
    .channel(`inventory:${orgId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_items', filter: `org_id=eq.${orgId}` },
      onChange)
    .subscribe();

export const subscribeToUsers = (
  orgId: string,
  onChange: (payload: any) => void
): RealtimeChannel =>
  supabase
    .channel(`users:${orgId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'users', filter: `org_id=eq.${orgId}` },
      onChange)
    .subscribe();

export const subscribeToActivityLogs = (
  orgId: string,
  onChange: (payload: any) => void
): RealtimeChannel =>
  supabase
    .channel(`activity_logs:${orgId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `org_id=eq.${orgId}` },
      onChange)
    .subscribe();

// ── Legacy compatibility shims ────────────────────────────────────────────────

export const auth = {
  signOut: signOut,
  onAuthStateChanged: (cb: (user: any) => void) => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      cb(session?.user ?? null);
    });
    return data.subscription.unsubscribe;
  },
};

export const serverTimestamp = () => new Date().toISOString();

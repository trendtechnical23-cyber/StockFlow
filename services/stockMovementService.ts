/**
 * Stock Movement Service (v2 — enterprise schema)
 *
 * Source of truth: stock_movements ledger
 * Current stock:   inventory_balances (materialized cache)
 *
 * All writes go through the backend API (which calls rpc_record_movement).
 * Direct supabase.from('stock_movements').insert() is intentionally NOT used
 * from the frontend — all mutations are server-validated.
 */

import { supabase } from './supabase';
import { getAccessToken } from './supabase';
import { API_ENDPOINTS } from '../utils/apiConfig';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MovementType =
  | 'OPENING_BALANCE'
  | 'RECEIVE'
  | 'SALE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'DAMAGE'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'STOCKTAKE_GAIN'
  | 'STOCKTAKE_LOSS';

export interface StockMovement {
  id:            string;
  orgId:         string;
  itemId:        string;
  locationId:    string | null;
  movementType:  MovementType;
  quantity:      number;       // positive = in, negative = out
  unitCost:      number | null;
  referenceType: string | null;
  referenceId:   string | null;
  notes:         string | null;
  performedBy:   string;
  balanceAfter:  number | null;
  createdAt:     string;
  performer?: { id: string; fullName: string | null; email: string | null };
  item?:      { id: string; sku: string; name: string };
}

export interface InventoryBalance {
  id:         string;
  orgId:      string;
  itemId:     string;
  locationId: string | null;
  quantity:   number;
  updatedAt:  string;
}

export interface StockSummaryRow {
  itemId:        string;
  sku:           string;
  name:          string;
  categoryId:    string | null;
  unitCost:      number | null;
  unitPrice:     number | null;
  currentStock:  number;
  minimumStock:  number;
  reorderPoint:  number | null;
  isLowStock:    boolean;
  isOutOfStock:  boolean;
  isPriority:    boolean;
}

export interface ApprovalRequest {
  id:              string;
  type:            string;
  status:          'pending' | 'approved' | 'rejected' | 'cancelled';
  delta:           number | null;
  reason:          string | null;
  reviewNotes:     string | null;
  createdAt:       string;
  reviewedAt:      string | null;
  itemId:          string | null;
  itemName:        string | null;
  itemSKU:         string | null;
  requestedBy:     string;
  requestedByName: string | null;
  reviewedBy:      string | null;
  reviewedByName:  string | null;
  metadata:        Record<string, any>;
}

// ── Read: stock summary ───────────────────────────────────────────────────────

/**
 * Get all active items with their current stock levels.
 * Uses rpc_get_org_stock_summary (joins inventory_items + inventory_balances).
 */
export const getOrgStockSummary = async (orgId: string): Promise<StockSummaryRow[]> => {
  const { data, error } = await supabase.rpc('rpc_get_org_stock_summary', { p_org_id: orgId });
  if (error) throw new Error(`Stock summary failed: ${error.message}`);

  return ((data as any[]) ?? []).map((row): StockSummaryRow => ({
    itemId:       row.item_id,
    sku:          row.sku,
    name:         row.name,
    categoryId:   row.category_id ?? null,
    unitCost:     row.unit_cost ?? null,
    unitPrice:    row.unit_price ?? null,
    currentStock: Number(row.current_stock ?? 0),
    minimumStock: Number(row.minimum_stock ?? 0),
    reorderPoint: row.reorder_point != null ? Number(row.reorder_point) : null,
    isLowStock:   !!row.is_low_stock,
    isOutOfStock: !!row.is_out_of_stock,
    isPriority:   !!row.is_priority,
  }));
};

/**
 * Get current stock for a single item.
 */
export const getItemStock = async (itemId: string, locationId: string | null = null): Promise<number> => {
  const { data, error } = await supabase.rpc('rpc_get_item_stock', {
    p_item_id:     itemId,
    p_location_id: locationId,
  });
  if (error) throw new Error(`Stock lookup failed: ${error.message}`);
  return Number(data ?? 0);
};

// ── Read: movement history ────────────────────────────────────────────────────

/**
 * Get movement history for one item.
 */
export const getItemMovements = async (
  orgId: string,
  itemId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<StockMovement[]> => {
  const { data, error } = await supabase
    .from('stock_movements')
    .select(`
      id, org_id, item_id, location_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, notes, performed_by, balance_after, created_at,
      performer:users!stock_movements_performed_by_fkey ( id, full_name, email )
    `)
    .eq('org_id', orgId)
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`Movement history failed: ${error.message}`);
  return ((data as any[]) ?? []).map(rowToMovement);
};

/**
 * Get org-wide movement feed (activity log).
 */
export const getOrgMovements = async (
  orgId: string,
  { limit = 100, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<StockMovement[]> => {
  const { data, error } = await supabase
    .from('stock_movements')
    .select(`
      id, org_id, item_id, location_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, notes, performed_by, balance_after, created_at,
      item:inventory_items!stock_movements_item_id_fkey ( id, sku, name ),
      performer:users!stock_movements_performed_by_fkey ( id, full_name, email )
    `)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`Org movements failed: ${error.message}`);
  return ((data as any[]) ?? []).map(rowToMovement);
};

// ── Read: approvals ───────────────────────────────────────────────────────────

/**
 * Get approval requests for an org.
 */
export const getApprovals = async (
  orgId: string,
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
): Promise<ApprovalRequest[]> => {
  let query = supabase
    .from('approval_requests')
    .select(`
      id, type, status, delta, reason, review_notes,
      created_at, reviewed_at, metadata,
      item:inventory_items!approval_requests_item_id_fkey ( id, name, sku ),
      requester:users!approval_requests_requested_by_fkey ( id, full_name, email ),
      reviewer:users!approval_requests_reviewed_by_fkey  ( id, full_name, email )
    `)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch approvals: ${error.message}`);

  return ((data as any[]) ?? []).map((row): ApprovalRequest => ({
    id:              row.id,
    type:            row.type,
    status:          row.status,
    delta:           row.delta != null ? Number(row.delta) : null,
    reason:          row.reason ?? null,
    reviewNotes:     row.review_notes ?? null,
    createdAt:       row.created_at,
    reviewedAt:      row.reviewed_at ?? null,
    itemId:          row.item?.id ?? null,
    itemName:        row.item?.name ?? null,
    itemSKU:         row.item?.sku ?? null,
    requestedBy:     row.requester?.id ?? '',
    requestedByName: row.requester?.full_name ?? row.requester?.email ?? null,
    reviewedBy:      row.reviewer?.id ?? null,
    reviewedByName:  row.reviewer?.full_name ?? row.reviewer?.email ?? null,
    metadata:        row.metadata ?? {},
  }));
};

// ── Write: approval actions (via backend API) ─────────────────────────────────

/**
 * Submit a stock adjustment request (staff → pending approval).
 */
export const submitAdjustmentRequest = async (
  orgId: string,
  itemId: string,
  delta: number,
  reason: string,
  idempotencyKey?: string
): Promise<string> => {
  // Generate idempotency key if not provided — prevents APK retry duplicates
  const key = idempotencyKey ?? crypto.randomUUID();
  const token = await getAccessToken();
  const res = await fetch(`${getApiBase()}/api/approvals/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ orgId, itemId, delta, reason, idempotencyKey: key }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `Request failed: ${res.status}`);
  return json.approvalId as string;
};

/**
 * Approve a pending request (managers only).
 */
export const approveRequest = async (
  orgId: string,
  approvalId: string,
  notes?: string
): Promise<void> => {
  const token = await getAccessToken();
  const res = await fetch(`${getApiBase()}/api/approvals/${approvalId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ orgId, notes }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `Approval failed: ${res.status}`);
};

/**
 * Reject a pending request (managers only).
 */
export const rejectRequest = async (
  orgId: string,
  approvalId: string,
  notes: string
): Promise<void> => {
  if (!notes?.trim()) throw new Error('Rejection reason is required');

  const token = await getAccessToken();
  const res = await fetch(`${getApiBase()}/api/approvals/${approvalId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ orgId, notes }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `Rejection failed: ${res.status}`);
};

// ── Realtime subscriptions ────────────────────────────────────────────────────

/**
 * Subscribe to inventory_balances changes for an org.
 * Fires callback whenever any balance is updated.
 * Returns an unsubscribe function.
 */
export const subscribeToBalances = (
  orgId: string,
  onUpdate: (balances: InventoryBalance[]) => void
): (() => void) => {
  const fetchAll = async () => {
    const { data } = await supabase
      .from('inventory_balances')
      .select('*')
      .eq('org_id', orgId);

    onUpdate(
      ((data as any[]) ?? []).map((row): InventoryBalance => ({
        id:         row.id,
        orgId:      row.org_id,
        itemId:     row.item_id,
        locationId: row.location_id ?? null,
        quantity:   Number(row.quantity),
        updatedAt:  row.updated_at,
      }))
    );
  };

  fetchAll();

  const channel = supabase
    .channel(`balances:${orgId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_balances', filter: `org_id=eq.${orgId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
};

/**
 * Subscribe to approval_requests for an org (live updates for the approvals view).
 * Returns an unsubscribe function.
 */
export const subscribeToApprovals = (
  orgId: string,
  onUpdate: (approvals: ApprovalRequest[]) => void
): (() => void) => {
  const fetchAll = () => getApprovals(orgId).then(onUpdate).catch(console.error);

  fetchAll();

  const channel = supabase
    .channel(`approvals:${orgId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'approval_requests', filter: `org_id=eq.${orgId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToMovement(row: any): StockMovement {
  return {
    id:            row.id,
    orgId:         row.org_id,
    itemId:        row.item_id ?? row.item?.id,
    locationId:    row.location_id ?? null,
    movementType:  row.movement_type,
    quantity:      Number(row.quantity),
    unitCost:      row.unit_cost != null ? Number(row.unit_cost) : null,
    referenceType: row.reference_type ?? null,
    referenceId:   row.reference_id ?? null,
    notes:         row.notes ?? null,
    performedBy:   row.performed_by,
    balanceAfter:  row.balance_after != null ? Number(row.balance_after) : null,
    createdAt:     row.created_at,
    performer:     row.performer
      ? { id: row.performer.id, fullName: row.performer.full_name, email: row.performer.email }
      : undefined,
    item:          row.item
      ? { id: row.item.id, sku: row.item.sku, name: row.item.name }
      : undefined,
  };
}

function getApiBase(): string {
  return (import.meta as any).env?.VITE_BACKEND_URL
    ?? process.env.REACT_APP_BACKEND_URL
    ?? '';
}

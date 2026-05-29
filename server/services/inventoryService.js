/**
 * Inventory Service
 *
 * All stock mutations go through rpc_record_movement (Postgres RPC).
 * Never call supabase.from('inventory_balances').update() directly.
 * Never call supabase.from('stock_movements').insert() directly.
 *
 * Flow:
 *   inventoryService.recordMovement(...)
 *     → rpc_record_movement (Postgres RPC)
 *       → INSERT stock_movements
 *         → trigger fn_update_inventory_balance → upsert inventory_balances
 *         → trigger fn_check_low_stock → insert notification if threshold crossed
 */

const { supabase } = require('../supabaseAdmin');

class InventoryService {

  /**
   * Record a stock movement (the ONLY correct way to change stock levels).
   *
   * @param {object} opts
   * @param {string} opts.orgId
   * @param {string} opts.itemId
   * @param {string|null} opts.locationId
   * @param {string} opts.movementType  - movement_type enum value
   * @param {number} opts.quantity      - positive = in, negative = out
   * @param {number|null} opts.unitCost
   * @param {string|null} opts.referenceType - 'approval_request' | 'stock_take_session' | 'manual'
   * @param {string|null} opts.referenceId
   * @param {string|null} opts.notes
   * @param {string} opts.performedBy   - user UUID
   * @returns {Promise<string>} movementId
   */
  async recordMovement({
    orgId,
    itemId,
    locationId = null,
    movementType,
    quantity,
    unitCost = null,
    referenceType = null,
    referenceId = null,
    notes = null,
    performedBy,
  }) {
    const { data, error } = await supabase.rpc('rpc_record_movement', {
      p_org_id:         orgId,
      p_item_id:        itemId,
      p_location_id:    locationId,
      p_movement_type:  movementType,
      p_quantity:       quantity,
      p_unit_cost:      unitCost,
      p_reference_type: referenceType,
      p_reference_id:   referenceId,
      p_notes:          notes,
      p_performed_by:   performedBy,
    });

    if (error) throw new Error(`Movement failed: ${error.message}`);
    return data; // movement UUID
  }

  /**
   * Get current stock for an item (reads inventory_balances cache).
   *
   * @param {string} itemId
   * @param {string|null} locationId  - null = sum across all locations
   * @returns {Promise<number>}
   */
  async getItemStock(itemId, locationId = null) {
    const { data, error } = await supabase.rpc('rpc_get_item_stock', {
      p_item_id:     itemId,
      p_location_id: locationId,
    });
    if (error) throw new Error(`Stock lookup failed: ${error.message}`);
    return Number(data ?? 0);
  }

  /**
   * Get org-wide stock summary (joins items + balances in one query).
   * Used by the dashboard inventory table.
   *
   * @param {string} orgId
   * @returns {Promise<Array>}
   */
  async getOrgStockSummary(orgId) {
    const { data, error } = await supabase.rpc('rpc_get_org_stock_summary', {
      p_org_id: orgId,
    });
    if (error) throw new Error(`Stock summary failed: ${error.message}`);
    return data ?? [];
  }

  /**
   * Get movement history for one item.
   *
   * @param {string} orgId
   * @param {string} itemId
   * @param {object} opts
   * @param {number} opts.limit
   * @param {number} opts.offset
   * @returns {Promise<Array>}
   */
  async getMovementHistory(orgId, itemId, { limit = 50, offset = 0 } = {}) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        id, movement_type, quantity, unit_cost, notes,
        reference_type, reference_id, balance_after, created_at,
        performer:users!stock_movements_performed_by_fkey ( id, full_name, email )
      `)
      .eq('org_id', orgId)
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Movement history failed: ${error.message}`);
    return data ?? [];
  }

  /**
   * Get all org movements (activity feed / audit log).
   *
   * @param {string} orgId
   * @param {object} opts
   * @returns {Promise<Array>}
   */
  async getOrgMovements(orgId, { limit = 100, offset = 0, movementType = null } = {}) {
    let query = supabase
      .from('stock_movements')
      .select(`
        id, movement_type, quantity, unit_cost, notes,
        reference_type, reference_id, balance_after, created_at,
        item:inventory_items!stock_movements_item_id_fkey ( id, sku, name ),
        performer:users!stock_movements_performed_by_fkey ( id, full_name, email )
      `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (movementType) query = query.eq('movement_type', movementType);

    const { data, error } = await query;
    if (error) throw new Error(`Org movements failed: ${error.message}`);
    return data ?? [];
  }

  /**
   * Record an opening balance for a new item.
   * Convenience wrapper around recordMovement.
   */
  async setOpeningBalance({ orgId, itemId, locationId = null, quantity, unitCost = null, performedBy }) {
    if (quantity === 0) return null;
    return this.recordMovement({
      orgId, itemId, locationId,
      movementType: 'OPENING_BALANCE',
      quantity,
      unitCost,
      referenceType: 'manual',
      notes: 'Opening balance',
      performedBy,
    });
  }

  /**
   * Receive stock from supplier.
   */
  async receiveStock({ orgId, itemId, locationId = null, quantity, unitCost = null, performedBy, notes = null }) {
    return this.recordMovement({
      orgId, itemId, locationId,
      movementType: 'RECEIVE',
      quantity: Math.abs(quantity),
      unitCost,
      referenceType: 'manual',
      notes,
      performedBy,
    });
  }

  /**
   * Issue / sell stock.
   */
  async issueStock({ orgId, itemId, locationId = null, quantity, performedBy, notes = null, referenceType = null, referenceId = null }) {
    return this.recordMovement({
      orgId, itemId, locationId,
      movementType: 'SALE',
      quantity: -Math.abs(quantity),
      referenceType,
      referenceId,
      notes,
      performedBy,
    });
  }
}

module.exports = new InventoryService();

/**
 * Approval Service
 *
 * All approval mutations go through rpc_process_approval (Postgres RPC).
 * The RPC runs inside a single transaction:
 *   - locks the row (prevents double-approval)
 *   - updates status + reviewer fields
 *   - creates stock_movement on approval
 *   - inserts targeted + org-wide notifications
 *   - writes activity_log
 *
 * After the RPC returns, this service fires FCM push notifications
 * via the notificationWorker — DB is always written first.
 */

const { supabase } = require('../supabaseAdmin');
const notificationWorker = require('./notificationWorker');

class ApprovalService {

  /**
   * Approve a pending request.
   *
   * @param {object} opts
   * @param {string} opts.orgId
   * @param {string} opts.approvalId
   * @param {string} opts.reviewerUid
   * @param {string} [opts.notes]
   * @returns {Promise<void>}
   */
  async approve({ orgId, approvalId, reviewerUid, notes = null }) {
    await this._processApproval({ orgId, approvalId, reviewerUid, decision: 'approved', notes });
  }

  /**
   * Reject a pending request.
   *
   * @param {object} opts
   * @param {string} opts.orgId
   * @param {string} opts.approvalId
   * @param {string} opts.reviewerUid
   * @param {string} opts.notes      - rejection reason (required)
   * @returns {Promise<void>}
   */
  async reject({ orgId, approvalId, reviewerUid, notes }) {
    if (!notes?.trim()) throw new Error('Rejection reason is required');
    await this._processApproval({ orgId, approvalId, reviewerUid, decision: 'rejected', notes });
  }

  /**
   * Create a new pending approval request.
   * Called by APK or staff dashboard when submitting a stock adjustment.
   *
   * @param {object} opts
   * @returns {Promise<string>} approvalId
   */
  async createRequest({ orgId, requestedBy, itemId, delta, reason, referenceType = 'manual', referenceId = null }) {
    // 1. Insert the approval request
    const { data, error } = await supabase
      .from('approval_requests')
      .insert({
        org_id:         orgId,
        type:           'stock_adjustment',
        reference_type: referenceType,
        reference_id:   referenceId,
        item_id:        itemId,
        delta:          delta,
        reason:         reason,
        requested_by:   requestedBy,
        status:         'pending',
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to create approval request: ${error.message}`);

    const approvalId = data.id;

    // 2. Get item and requester info for the notification body
    const [{ data: item }, { data: requester }] = await Promise.all([
      supabase.from('inventory_items').select('name, sku').eq('id', itemId).maybeSingle(),
      supabase.from('users').select('full_name, email').eq('id', requestedBy).maybeSingle(),
    ]);

    const itemName      = item?.name ?? 'an item';
    const requesterName = requester?.full_name ?? requester?.email ?? 'A staff member';
    const sign          = delta > 0 ? '+' : '';

    // 3. Notify all managers (targeted, not broadcast)
    const { data: managers } = await supabase
      .from('users')
      .select('id')
      .eq('org_id', orgId)
      .in('legacy_role', ['owner', 'manager']);

    if (managers?.length) {
      // Insert event + per-manager recipient rows via helper function
    const { error: notifError } = await supabase.rpc('fn_notify_managers', {
        p_org_id: orgId,
        p_type:   'approval_pending',
        p_title:  '🔔 Approval Required',
        p_body:   `${requesterName} requested a ${sign}${delta} unit adjustment for ${itemName}`,
        p_data:   { approvalId, itemId, itemName, delta, requesterName, requestedBy },
      });
      if (notifError) console.error('⚠️ Failed to insert manager notifications:', notifError.message);

      // 4. Fire FCM push to each manager
      await notificationWorker.sendToUsers(
        managers.map(m => m.id),
        {
          type:  'approval_pending',
          title: '🔔 Approval Required',
          body:  `${requesterName} requested a ${sign}${delta} unit adjustment for ${itemName}`,
          data:  { approvalId, itemId, itemName: String(itemName), delta: String(delta) },
        }
      );
    }

    // 5. Activity log
    await supabase.from('activity_logs').insert({
      org_id:      orgId,
      user_id:     requestedBy,
      action:      'create_approval_request',
      entity_type: 'approval_request',
      entity_id:   approvalId,
      details:     { itemId, itemName, delta, reason },
    });

    console.log(`✅ Approval request created: ${approvalId}`);
    return approvalId;
  }

  /**
   * Get paginated approval requests for an org.
   *
   * @param {string} orgId
   * @param {object} opts
   * @returns {Promise<Array>}
   */
  async getApprovals(orgId, { status = null, limit = 50, offset = 0 } = {}) {
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
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch approvals: ${error.message}`);

    return (data ?? []).map(row => ({
      id:              row.id,
      type:            row.type,
      status:          row.status,
      delta:           row.delta,
      reason:          row.reason,
      reviewNotes:     row.review_notes,
      createdAt:       row.created_at,
      reviewedAt:      row.reviewed_at,
      itemId:          row.item?.id,
      itemName:        row.item?.name,
      itemSKU:         row.item?.sku,
      requestedBy:     row.requester?.id,
      requestedByName: row.requester?.full_name ?? row.requester?.email,
      reviewedBy:      row.reviewer?.id,
      reviewedByName:  row.reviewer?.full_name ?? row.reviewer?.email,
      metadata:        row.metadata,
    }));
  }

  // ── private ────────────────────────────────────────────────────

  async _processApproval({ orgId, approvalId, reviewerUid, decision, notes }) {
    // 1. Transactional update via RPC (locks row, writes movement, writes notifications, writes log)
    const { error } = await supabase.rpc('rpc_process_approval', {
      p_approval_id: approvalId,
      p_reviewer_id: reviewerUid,
      p_decision:    decision,
      p_notes:       notes ?? null,
    });

    if (error) throw new Error(`Failed to ${decision} approval: ${error.message}`);

    // 2. Fetch the updated request + requester for FCM push
    const { data: approval } = await supabase
      .from('approval_requests')
      .select(`
        requested_by, item_id, delta,
        item:inventory_items!approval_requests_item_id_fkey ( name )
      `)
      .eq('id', approvalId)
      .maybeSingle();

    if (!approval) return;

    const itemName = approval.item?.name ?? 'an item';
    const sign     = (approval.delta ?? 0) > 0 ? '+' : '';

    // 3. Fire FCM to the requester
    await notificationWorker.sendToUsers(
      [approval.requested_by],
      {
        type:  decision === 'approved' ? 'approved' : 'rejected',
        title: decision === 'approved' ? '✅ Request Approved' : '❌ Request Rejected',
        body:  decision === 'approved'
          ? `Your ${sign}${approval.delta} unit request for ${itemName} was approved`
          : `Your ${sign}${approval.delta} unit request for ${itemName} was rejected${notes ? ': ' + notes : ''}`,
        data: {
          approvalId,
          itemId:   approval.item_id ?? '',
          itemName: String(itemName),
          decision,
        },
      }
    );

    console.log(`✅ Approval ${approvalId} ${decision} by ${reviewerUid}`);
  }
}

module.exports = new ApprovalService();

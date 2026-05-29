/**
 * Approval Routes
 *
 * POST /api/approvals/request   — staff submits a stock adjustment request
 * GET  /api/approvals/:orgId    — list approvals for an org
 * POST /api/approvals/:id/approve — manager approves
 * POST /api/approvals/:id/reject  — manager rejects
 */

const express         = require('express');
const router          = express.Router();
const approvalService = require('../services/approvalService');
const { verifyFirebaseToken, requireManagerRole } = require('../middleware/auth');

// All approval routes require authentication
router.use(verifyFirebaseToken);

// ── POST /api/approvals/request ──────────────────────────────────
router.post('/request', async (req, res) => {
  try {
    const { orgId, itemId, delta, reason } = req.body;
    const requestedBy = req.user.uid;

    if (!orgId || !itemId || delta === undefined || delta === null) {
      return res.status(400).json({
        success: false,
        message: 'orgId, itemId, and delta are required',
      });
    }

    if (delta === 0) {
      return res.status(400).json({ success: false, message: 'delta must be non-zero' });
    }

    const approvalId = await approvalService.createRequest({
      orgId,
      requestedBy,
      itemId,
      delta: Number(delta),
      reason,
    });

    res.status(201).json({ success: true, approvalId });
  } catch (err) {
    console.error('[approvals] POST /request:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/approvals/:orgId ─────────────────────────────────────
router.get('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;

    const approvals = await approvalService.getApprovals(orgId, {
      status: status || null,
      limit:  Number(limit),
      offset: Number(offset),
    });

    res.json({ success: true, approvals });
  } catch (err) {
    console.error('[approvals] GET /:orgId:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/approvals/:id/approve ──────────────────────────────
router.post('/:id/approve', requireManagerRole, async (req, res) => {
  try {
    const { id: approvalId } = req.params;
    const { orgId, notes }   = req.body;
    const reviewerUid        = req.user.uid;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'orgId is required' });
    }

    await approvalService.approve({ orgId, approvalId, reviewerUid, notes });
    res.json({ success: true, message: 'Request approved' });
  } catch (err) {
    console.error('[approvals] POST /:id/approve:', err.message);
    res.status(err.message.includes('already') ? 409 : 500)
       .json({ success: false, message: err.message });
  }
});

// ── POST /api/approvals/:id/reject ───────────────────────────────
router.post('/:id/reject', requireManagerRole, async (req, res) => {
  try {
    const { id: approvalId } = req.params;
    const { orgId, notes }   = req.body;
    const reviewerUid        = req.user.uid;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'orgId is required' });
    }

    if (!notes?.trim()) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    await approvalService.reject({ orgId, approvalId, reviewerUid, notes });
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) {
    console.error('[approvals] POST /:id/reject:', err.message);
    res.status(err.message.includes('already') ? 409 : 500)
       .json({ success: false, message: err.message });
  }
});

module.exports = router;

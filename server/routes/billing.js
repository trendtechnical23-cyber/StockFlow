const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { verifyFirebaseToken } = require('../middleware/auth');
const { supabase } = require('../supabaseAdmin');

// PayFast configuration
const PAYFAST_MERCHANT_ID  = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE   = process.env.PAYFAST_PASSPHRASE;
const PAYFAST_ENV          = process.env.PAYFAST_ENV || 'sandbox';

const isPayFastConfigured = !!(PAYFAST_MERCHANT_ID && PAYFAST_MERCHANT_KEY && PAYFAST_PASSPHRASE);
if (!isPayFastConfigured) {
  console.warn('⚠️ PayFast credentials not configured — billing routes will return 503 until set');
}

const PAYFAST_URL = PAYFAST_ENV === 'production'
  ? 'https://www.payfast.co.za/eng/process'
  : 'https://sandbox.payfast.co.za/eng/process';

const requirePayFast = (req, res, next) => {
  if (!isPayFastConfigured) {
    return res.status(503).json({ error: 'Billing service not configured', message: 'PayFast integration is not available' });
  }
  next();
};

const generateSignature = (data, passphrase = '') => {
  const keys = Object.keys(data).sort();
  let queryString = '';
  keys.forEach(key => {
    if (data[key] !== '' && key !== 'signature') {
      queryString += `${key}=${encodeURIComponent(data[key].toString().trim()).replace(/%20/g, '+')}&`;
    }
  });
  if (passphrase) {
    queryString += `passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`;
  } else {
    queryString = queryString.substring(0, queryString.length - 1);
  }
  return crypto.createHash('md5').update(queryString).digest('hex');
};

/**
 * POST /api/billing/payfast/create-subscription
 */
router.post('/payfast/create-subscription', requirePayFast, async (req, res) => {
  try {
    const { plan, organizationId, amount, itemName } = req.body;
    if (!plan || !organizationId || !amount) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const host = process.env.PUBLIC_URL || 'https://stockflow-dashboard.vercel.app';
    const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host;

    const formData = {
      merchant_id: PAYFAST_MERCHANT_ID,
      merchant_key: PAYFAST_MERCHANT_KEY,
      return_url: `${baseUrl}/?view=billing-success`,
      cancel_url: `${baseUrl}/?view=billing-cancel`,
      notify_url: `${process.env.BACKEND_URL || process.env.RAILWAY_STATIC_URL || ''}/api/billing/payfast/itn`,
      m_payment_id: `SF-${organizationId}-${Date.now()}`,
      amount: parseFloat(amount).toFixed(2),
      item_name: itemName || `StockFlow ${plan} Plan`,
      subscription_type: '1',
      recurring_amount: parseFloat(amount).toFixed(2),
      frequency: '3',
      cycles: '0',
      custom_str1: organizationId,
      custom_str2: plan,
    };

    formData.signature = generateSignature(formData, PAYFAST_PASSPHRASE);

    res.json({ formData, actionUrl: PAYFAST_URL });
  } catch (error) {
    console.error('Error creating PayFast subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/billing/payfast/itn
 * Instant Transaction Notification
 */
router.post('/payfast/itn', requirePayFast, async (req, res) => {
  try {
    const data = req.body;

    const signature  = data.signature;
    const generated  = generateSignature(data, PAYFAST_PASSPHRASE);
    if (signature !== generated) {
      console.error('❌ PayFast ITN: Invalid signature');
      return res.status(400).send('Invalid signature');
    }

    const organizationId  = data.custom_str1;
    const plan            = data.custom_str2;
    const paymentStatus   = data.payment_status;

    if (!organizationId || !plan) {
      return res.status(400).send('Missing required fields');
    }

    const validPlans = ['Free', 'Pro', 'Enterprise'];
    if (!validPlans.includes(plan)) {
      return res.status(400).send('Invalid plan');
    }

    const paymentId = data.pf_payment_id;

    // Idempotency check
    if (paymentId) {
      const { data: existing } = await supabase
        .from('activity_logs')
        .select('id')
        .eq('org_id', organizationId)
        .eq('type', 'billing')
        .contains('details', { pf_payment_id: paymentId })
        .limit(1);
      if (existing && existing.length > 0) {
        console.log(`⚠️ Payment ${paymentId} already processed — skipping`);
        return res.status(200).send('OK');
      }
    }

    // Verify organization exists
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', organizationId)
      .maybeSingle();
    if (!org) {
      console.error(`❌ PayFast ITN: Organization ${organizationId} not found`);
      return res.status(400).send('Organization not found');
    }

    if (paymentStatus === 'COMPLETE') {
      await supabase.from('organizations').update({
        plan,
        updated_at: new Date().toISOString(),
      }).eq('id', organizationId);

      await supabase.from('activity_logs').insert({
        org_id: organizationId,
        type: 'billing',
        details: {
          plan,
          pf_payment_id: paymentId,
          status: 'COMPLETE',
          performed_by: 'System (PayFast)',
        },
      });

      console.log(`✅ Subscription updated for org: ${organizationId} → ${plan}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing PayFast ITN:', error);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * GET /api/billing/validate/:organizationId
 */
router.get('/validate/:organizationId', verifyFirebaseToken, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { data: org, error } = await supabase
      .from('organizations')
      .select('id, plan')
      .eq('id', organizationId)
      .maybeSingle();

    if (error || !org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({ isValid: true, plan: org.plan || 'free' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/billing/cancel-subscription
 */
router.post('/cancel-subscription', verifyFirebaseToken, requirePayFast, async (req, res) => {
  try {
    const { organizationId } = req.body;
    await supabase
      .from('organizations')
      .update({ plan: 'free', updated_at: new Date().toISOString() })
      .eq('id', organizationId);
    res.json({ success: true, message: 'Subscription cancellation scheduled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/billing/history/:organizationId
 */
router.get('/history/:organizationId', verifyFirebaseToken, requirePayFast, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { data: history, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('org_id', organizationId)
      .eq('type', 'billing')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    res.json(history || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

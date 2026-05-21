const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');
const { verifyFirebaseToken } = require('../middleware/auth');

const getDb = () => admin.firestore();

// PayFast configuration from environment variables (NO FALLBACKS FOR SECURITY)
const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;
const PAYFAST_ENV = process.env.PAYFAST_ENV || 'sandbox'; // sandbox or production

// Check if PayFast is configured (warn but don't crash server)
const isPayFastConfigured = !!(PAYFAST_MERCHANT_ID && PAYFAST_MERCHANT_KEY && PAYFAST_PASSPHRASE);

if (!isPayFastConfigured) {
  console.warn('⚠️  WARNING: PayFast credentials not configured in environment variables');
  console.warn('   Billing routes will return 503 Service Unavailable until credentials are set');
  console.warn('   Required: PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE');
}

// PayFast URLs
const PAYFAST_URL = PAYFAST_ENV === 'production' 
  ? 'https://www.payfast.co.za/eng/process' 
  : 'https://sandbox.payfast.co.za/eng/process';

// Middleware to check if PayFast is configured
const requirePayFast = (req, res, next) => {
  if (!isPayFastConfigured) {
    return res.status(503).json({
      error: 'Billing service not configured',
      message: 'PayFast integration is not available at this time'
    });
  }
  next();
};

/**
 * Generate PayFast Signature
 * @param {Object} data - Form data
 * @param {string} passphrase - Security passphrase
 * @returns {string} MD5 Signature
 */
const generateSignature = (data, passphrase = '') => {
  // Sort keys alphabetically
  const keys = Object.keys(data).sort();
  
  // Create query string
  let queryString = '';
  keys.forEach((key, index) => {
    if (data[key] !== '' && key !== 'signature') {
      queryString += `${key}=${encodeURIComponent(data[key].toString().trim()).replace(/%20/g, '+')}&`;
    }
  });

  // Append passphrase
  if (passphrase) {
    queryString += `passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`;
  } else {
    // Remove trailing & if no passphrase
    queryString = queryString.substring(0, queryString.length - 1);
  }

  // Generate MD5 hash
  return crypto.createHash('md5').update(queryString).digest('hex');
};

/**
 * POST /api/billing/payfast/create-subscription
 * Generates the form data and signature for PayFast redirect
 */
router.post('/payfast/create-subscription', requirePayFast, async (req, res) => {
  try {
    const { plan, organizationId, amount, itemName } = req.body;
    
    if (!plan || !organizationId || !amount) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const host = process.env.PUBLIC_URL || 'https://stockflow-dashboard.web.app';
    const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host;
    
    // PayFast subscription data (Recurring)
    const formData = {
      // Merchant details
      merchant_id: PAYFAST_MERCHANT_ID,
      merchant_key: PAYFAST_MERCHANT_KEY,
      
      // Return URLs
      return_url: `${baseUrl}/?view=billing-success`,
      cancel_url: `${baseUrl}/?view=billing-cancel`,
      notify_url: `${process.env.BACKEND_URL || 'https://api.stockflow.co'}/api/billing/payfast/itn`,
      
      // Transaction details
      m_payment_id: `SF-${organizationId}-${Date.now()}`,
      amount: parseFloat(amount).toFixed(2),
      item_name: itemName || `StockFlow ${plan} Plan`,
      
      // Billing details (Recurring)
      // 1 = Monthly, 2 = Quarterly, 3 = Biannually, 4 = Annually, 5 = Weekly
      subscription_type: '1', 
      recurring_amount: parseFloat(amount).toFixed(2),
      frequency: '3', // Monthly
      cycles: '0', // 0 = Infinite / Until cancelled
      
      // Custom data
      custom_str1: organizationId,
      custom_str2: plan
    };

    // Generate signature
    formData.signature = generateSignature(formData, PAYFAST_PASSPHRASE);

    res.json({
      formData,
      actionUrl: PAYFAST_URL
    });
  } catch (error) {
    console.error('Error creating PayFast subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/billing/payfast/itn
 * Instant Transaction Notification (Webhook)
 */
router.post('/payfast/itn', requirePayFast, async (req, res) => {
  try {
    const data = req.body;
    console.log('Received PayFast ITN:', data);

    // 1. Validate signature FIRST — before any database writes
    const signature = data.signature;
    const generated = generateSignature(data, PAYFAST_PASSPHRASE);
    
    if (signature !== generated) {
      console.error('❌ PayFast ITN: Invalid signature');
      return res.status(400).send('Invalid signature');
    }

    // 2. Validate required fields
    const organizationId = data.custom_str1;
    const plan = data.custom_str2;
    const paymentStatus = data.payment_status;

    if (!organizationId || !plan) {
      console.error('❌ PayFast ITN: Missing custom_str1 (orgId) or custom_str2 (plan)');
      return res.status(400).send('Missing required fields');
    }

    // 3. Whitelist valid plans
    const validPlans = ['Free', 'Pro', 'Enterprise'];
    if (!validPlans.includes(plan)) {
      console.error(`❌ PayFast ITN: Invalid plan "${plan}"`);
      return res.status(400).send('Invalid plan');
    }

    // 4. Check idempotency — prevent duplicate processing of same payment
    const paymentId = data.pf_payment_id;
    if (paymentId) {
      const existingPayment = await getDb().collection('activities')
        .where('type', '==', 'billing')
        .where('details', '==', `Subscription for ${plan} plan successful. Payment ID: ${paymentId}`)
        .limit(1)
        .get();
      
      if (!existingPayment.empty) {
        console.log(`⚠️ PayFast ITN: Payment ${paymentId} already processed — skipping`);
        return res.status(200).send('OK');
      }
    }

    // 5. Verify organization exists
    const orgRef = getDb().collection('organizations').doc(organizationId);
    const orgDoc = await orgRef.get();
    if (!orgDoc.exists) {
      console.error(`❌ PayFast ITN: Organization ${organizationId} not found`);
      return res.status(400).send('Organization not found');
    }

    // 6. Process the payment
    if (paymentStatus === 'COMPLETE') {
      await orgRef.set({
        subscription: {
          plan: plan,
          status: 'active',
          paymentId: paymentId,
          lastPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
          nextPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
          provider: 'payfast'
        }
      }, { merge: true });

      await getDb().collection('activities').add({
        type: 'billing',
        action: 'subscription_payment',
        organizationId,
        details: `Subscription for ${plan} plan successful. Payment ID: ${paymentId}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        performedBy: 'System (PayFast)'
      });

      console.log(`✅ Subscription updated for org: ${organizationId}`);
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
    const orgDoc = await getDb().collection('organizations').doc(organizationId).get();

    if (!orgDoc.exists) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const data = orgDoc.data();
    const subscription = data.subscription || { plan: 'Free', status: 'active' };

    // Check if plan is active and not expired
    const isValid = subscription.status === 'active';

    res.json({ isValid, plan: subscription.plan });
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
    
    // In a real PayFast setup, you might call their API to cancel recurring billing
    // For this implementation, we mark it as cancelling in our DB
    
    await getDb().collection('organizations').doc(organizationId).update({
      'subscription.status': 'cancelling',
      'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });

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
    const activities = await getDb().collection('activities')
      .where('organizationId', '==', organizationId)
      .where('type', '==', 'billing')
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();

    const history = activities.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

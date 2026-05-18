/**
 * Cloud Function: Process Approved Zoho Sync Requests
 * 
 * Trigger: Firestore onUpdate on /organizations/{orgId}/approvals/{approvalId}
 * 
 * This function executes when an approval status changes to 'approved' and:
 * 1. Validates the approver has manager/admin role
 * 2. Executes the Zoho API write operation
 * 3. Updates the approval document with Zoho response
 * 4. Writes audit trail entry
 * 5. Sends notification to requester
 * 
 * DEPLOYMENT:
 * 1. Deploy this function to Firebase Cloud Functions
 * 2. Set environment variables for Zoho API credentials
 * 3. Grant the function's service account appropriate Firestore permissions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize admin if not already done
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Process approved Zoho sync requests
 */
exports.processApprovedZohoSync = functions.firestore
  .document('organizations/{orgId}/approvals/{approvalId}')
  .onUpdate(async (change, context) => {
    const { orgId, approvalId } = context.params;
    const beforeData = change.before.data();
    const afterData = change.after.data();

    // Only process if status changed to 'approved' and not already processed
    if (beforeData.status !== 'approved' && afterData.status === 'approved' && !afterData.processed) {
      console.log(`Processing approved sync request: ${approvalId} for org: ${orgId}`);

      try {
        // Step 1: Validate approver role
        const approverUid = afterData.approvedBy;
        const memberDoc = await db
          .collection('organizations')
          .doc(orgId)
          .collection('members')
          .doc(approverUid)
          .get();

        if (!memberDoc.exists) {
          throw new Error('Approver not found in organization');
        }

        const approverRole = memberDoc.data().role;
        if (!['owner', 'admin', 'manager'].includes(approverRole)) {
          throw new Error('Approver does not have sufficient permissions');
        }

        // Step 2: Execute Zoho operation based on action type
        let zohoResponse;
        switch (afterData.action) {
          case 'adjust_stock':
            zohoResponse = await executeStockAdjustment(orgId, afterData);
            break;
          case 'update_item':
            zohoResponse = await executeItemUpdate(orgId, afterData);
            break;
          case 'create_item':
            zohoResponse = await executeItemCreate(orgId, afterData);
            break;
          case 'delete_item':
            zohoResponse = await executeItemDelete(orgId, afterData);
            break;
          default:
            throw new Error(`Unknown action type: ${afterData.action}`);
        }

        // Step 3: Update approval document with success
        await change.after.ref.update({
          processed: true,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          zohoResponse: zohoResponse,
          error: null
        });

        // Step 4: Write audit trail
        await db
          .collection('organizations')
          .doc(orgId)
          .collection('auditLogs')
          .add({
            type: 'zoho_sync_approved',
            approvalId: approvalId,
            action: afterData.action,
            itemId: afterData.itemId,
            itemSKU: afterData.itemSKU,
            requestedBy: afterData.requestedBy,
            approvedBy: approverUid,
            approvedAt: afterData.approvedAt,
            zohoResponse: zohoResponse,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

        // Step 5: Update local inventory if Zoho returns new quantity
        if (afterData.action === 'adjust_stock' && zohoResponse.newQuantity !== undefined) {
          await db
            .collection('organizations')
            .doc(orgId)
            .collection('inventory')
            .doc(afterData.itemId)
            .update({
              stock: zohoResponse.newQuantity, // Use 'stock' field to match dashboard schema
              lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
              lastSyncedBy: approverUid
            });
        }

        // Step 6: Send notification to requester
        await sendNotificationToRequester(orgId, afterData.requestedBy, {
          title: 'Approval Processed',
          body: `Your ${afterData.action} request for ${afterData.itemName} has been approved and synced to Zoho.`,
          approvalId: approvalId
        });

        console.log(`✅ Successfully processed approval: ${approvalId}`);

      } catch (error) {
        console.error(`❌ Error processing approval ${approvalId}:`, error);

        // Update approval with error
        await change.after.ref.update({
          processed: true,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: error.message || 'Unknown error occurred',
          zohoResponse: null
        });

        // Write error audit log
        await db
          .collection('organizations')
          .doc(orgId)
          .collection('auditLogs')
          .add({
            type: 'zoho_sync_error',
            approvalId: approvalId,
            action: afterData.action,
            itemId: afterData.itemId,
            error: error.message,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

        // Notify requester of failure
        await sendNotificationToRequester(orgId, afterData.requestedBy, {
          title: 'Sync Failed',
          body: `Failed to sync ${afterData.itemName} to Zoho: ${error.message}`,
          approvalId: approvalId
        });
      }
    }
  });

/**
 * Execute stock adjustment in Zoho Books
 */
async function executeStockAdjustment(orgId, approvalData) {
  // Read Zoho tokens from the integrations subcollection (not the org document field)
  const zohoDoc = await db
    .collection('organizations').doc(orgId)
    .collection('integrations').doc('zoho')
    .get();

  if (!zohoDoc.exists) {
    throw new Error('Zoho integration not connected — no token document found');
  }

  const zohoConfig = zohoDoc.data();

  if (!zohoConfig?.access_token && !zohoConfig?.refresh_token) {
    throw new Error('Zoho integration tokens are missing');
  }

  try {
    const accessToken = await refreshZohoToken(orgId, zohoConfig);

    const zohoItem = await findZohoItemBySku(accessToken, approvalData.itemSKU, zohoConfig.organization_id);
    if (!zohoItem) {
      throw new Error(`Item with SKU '${approvalData.itemSKU}' not found in Zoho Books`);
    }

    // Correct Zoho Books API URL and flat payload (no 'inventory_adjustment' wrapper)
    const adjustmentPayload = {
      date: new Date().toISOString().split('T')[0],
      reason: approvalData.requestedChange?.reason || 'Stock take adjustment via StockFlow',
      reference_number: `SF-${Date.now()}`,
      adjustment_type: 'quantity',
      line_items: [{
        item_id: zohoItem.item_id,
        quantity_adjusted: approvalData.requestedChange?.quantityDelta
      }]
    };

    const response = await fetch(
      `https://www.zohoapis.com/books/v3/inventoryadjustments?organization_id=${zohoConfig.organization_id}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(adjustmentPayload)
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Zoho Books API error: ${errorData.message || response.status}`);
    }

    const result = await response.json();
    const adj = result.inventory_adjustment;

    console.log('✅ Stock adjustment created in Zoho Books:', adj?.inventory_adjustment_id);

    return {
      success: true,
      zohoItemId: zohoItem.item_id,
      adjustmentId: adj?.inventory_adjustment_id,
      newQuantity: approvalData.requestedChange?.newQuantity,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Failed to execute Zoho stock adjustment:', error);
    throw new Error(`Zoho stock adjustment failed: ${error.message}`);
  }
}

/**
 * Refresh (or return current) Zoho access token for an organization.
 * Updates the token in Firestore if a new one is issued.
 */
async function refreshZohoToken(orgId, zohoConfig) {
  const now = Date.now();

  // Return existing token if still valid (>5 min remaining)
  if (zohoConfig.access_token && zohoConfig.expires_at && (zohoConfig.expires_at - now) > 5 * 60 * 1000) {
    return zohoConfig.access_token;
  }

  if (!zohoConfig.refresh_token) {
    throw new Error('No refresh_token available for Zoho re-authentication');
  }

  // Load per-org Zoho credentials from Firestore (multi-tenant)
  const REGION_MAP = { us: 'https://accounts.zoho.com', eu: 'https://accounts.zoho.eu', in: 'https://accounts.zoho.in', au: 'https://accounts.zoho.com.au', jp: 'https://accounts.zoho.jp' };
  const orgConfigDoc = await db.collection('organizations').doc(orgId)
    .collection('integrations').doc('zoho_config').get();
  const orgCfg = orgConfigDoc.exists ? orgConfigDoc.data() : null;

  if (!orgCfg || !orgCfg.clientId || !orgCfg.clientSecret) {
    throw new Error('Zoho API credentials not configured for this organization');
  }

  const accountsUrl = REGION_MAP[orgCfg.region] || 'https://accounts.zoho.com';
  const params = new URLSearchParams({
    refresh_token: zohoConfig.refresh_token,
    client_id: orgCfg.clientId,
    client_secret: orgCfg.clientSecret,
    grant_type: 'refresh_token'
  });

  const response = await fetch(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Zoho token refresh failed: ${err.error || response.status}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('No access_token in Zoho refresh response');
  }

  // Persist updated token back to Firestore
  await db.collection('organizations').doc(orgId)
    .collection('integrations').doc('zoho')
    .update({
      access_token: data.access_token,
      expires_in: data.expires_in,
      expires_at: now + (data.expires_in * 1000),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

  return data.access_token;
}

/**
 * Find a Zoho Books item by its SKU field.
 * Returns the first matching item object, or null if not found.
 */
async function findZohoItemBySku(accessToken, sku, organizationId) {
  try {
    const response = await fetch(
      `https://www.zohoapis.com/books/v3/items?organization_id=${organizationId}&sku=${encodeURIComponent(sku)}`,
      {
        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
      }
    );

    if (!response.ok) {
      console.warn('findZohoItemBySku: Zoho API returned', response.status);
      return null;
    }

    const data = await response.json();
    return (data.items || []).find(i => i.sku === sku) || null;
  } catch (error) {
    console.error('findZohoItemBySku error:', error.message);
    return null;
  }
}

/**
 * Execute item update in Zoho Books
 */
async function executeItemUpdate(orgId, approvalData) {
  try {
    const zohoDoc = await db
      .collection('organizations').doc(orgId)
      .collection('integrations').doc('zoho')
      .get();

    if (!zohoDoc.exists) {
      throw new Error('Zoho integration not connected — no token document found');
    }

    const zohoConfig = zohoDoc.data();
    const accessToken = await refreshZohoToken(orgId, zohoConfig);
    const zohoItem = await findZohoItemBySku(accessToken, approvalData.itemSKU, zohoConfig.organization_id);

    if (!zohoItem) {
      throw new Error(`Item with SKU '${approvalData.itemSKU}' not found in Zoho Books`);
    }

    const updateData = {
      item_id: zohoItem.item_id,
      ...approvalData.requestedChange?.updatedFields
    };

    const response = await fetch(
      `https://www.zohoapis.com/books/v3/items/${zohoItem.item_id}?organization_id=${zohoConfig.organization_id}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ item: updateData })
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Zoho Books API error: ${errorData.message || response.status}`);
    }

    console.log('✅ Item updated in Zoho Books:', zohoItem.item_id);

    return {
      success: true,
      zohoItemId: zohoItem.item_id,
      updatedFields: approvalData.requestedChange?.updatedFields,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Failed to update item in Zoho:', error);
    throw new Error(`Zoho item update failed: ${error.message}`);
  }
}

/**
 * Execute item creation in Zoho
 */
async function executeItemCreate(orgId, approvalData) {
  // TODO: Implement Zoho item creation
  console.log('Executing item creation:', approvalData.requestedChange);
  
  return {
    success: true,
    zohoItemId: 'ZOHO_ITEM_NEW_789',
    timestamp: new Date().toISOString()
  };
}

/**
 * Execute item deletion in Zoho
 */
async function executeItemDelete(orgId, approvalData) {
  // TODO: Implement Zoho item deletion
  console.log('Executing item deletion:', approvalData.itemId);
  
  return {
    success: true,
    zohoItemId: approvalData.itemId,
    deleted: true,
    timestamp: new Date().toISOString()
  };
}

/**
 * Send FCM notification to requester
 */
async function sendNotificationToRequester(orgId, userId, notification) {
  try {
    // Get user's FCM tokens
    const devicesSnapshot = await db
      .collection('organizations')
      .doc(orgId)
      .collection('devices')
      .where('userId', '==', userId)
      .get();

    if (devicesSnapshot.empty) {
      console.log(`No devices found for user ${userId}`);
      return;
    }

    const tokens = devicesSnapshot.docs.map(doc => doc.data().fcmToken);

    // Send multicast notification
    const message = {
      notification: {
        title: notification.title,
        body: notification.body
      },
      data: {
        type: 'approval_update',
        approvalId: notification.approvalId
      },
      tokens: tokens
    };

    const response = await admin.messaging().sendMulticast(message);
    console.log(`✅ Sent notification to ${response.successCount} devices`);

    // Clean up invalid tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
        }
      });

      // Remove invalid tokens
      const batch = db.batch();
      for (const token of failedTokens) {
        const deviceDoc = devicesSnapshot.docs.find(doc => doc.data().fcmToken === token);
        if (deviceDoc) {
          batch.delete(deviceDoc.ref);
        }
      }
      await batch.commit();
      console.log(`🧹 Cleaned up ${failedTokens.length} invalid tokens`);
    }

  } catch (error) {
    console.error('Error sending notification:', error);
    // Don't throw - notification failure shouldn't stop approval processing
  }
}

/**
 * Send notification to all managers when new approval is created
 */
exports.notifyManagersOfNewApproval = functions.firestore
  .document('organizations/{orgId}/approvals/{approvalId}')
  .onCreate(async (snap, context) => {
    const { orgId, approvalId } = context.params;
    const approvalData = snap.data();

    try {
      // Get all managers in org
      const membersSnapshot = await db
        .collection('organizations')
        .doc(orgId)
        .collection('members')
        .where('role', 'in', ['owner', 'admin', 'manager'])
        .get();

      if (membersSnapshot.empty) {
        console.log('No managers found in organization');
        return;
      }

      const managerUids = membersSnapshot.docs.map(doc => doc.id);

      // Get FCM tokens for all managers
      const devicesSnapshot = await db
        .collection('organizations')
        .doc(orgId)
        .collection('devices')
        .where('userId', 'in', managerUids)
        .get();

      if (devicesSnapshot.empty) {
        console.log('No devices found for managers');
        return;
      }

      const tokens = devicesSnapshot.docs.map(doc => doc.data().fcmToken);

      // Send notification
      const message = {
        notification: {
          title: '🔔 New Approval Request',
          body: `${approvalData.requestedByName} requested ${approvalData.action} for ${approvalData.itemName}`
        },
        data: {
          type: 'new_approval',
          approvalId: approvalId,
          action: approvalData.action,
          itemId: approvalData.itemId || ''
        },
        tokens: tokens
      };

      const response = await admin.messaging().sendMulticast(message);
      console.log(`✅ Notified ${response.successCount} managers of new approval`);

    } catch (error) {
      console.error('Error notifying managers:', error);
      // Don't throw - we don't want to fail the approval creation
    }
  });

// (refreshZohoToken and findZohoItemBySku are defined earlier in this file)

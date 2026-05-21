const express = require('express');
const admin = require('firebase-admin');
const { verifyFirebaseToken, requireOrg } = require('../middleware/auth');
const { sendStockActivityNotification } = require('../sendNotification');

const router = express.Router();
const getDb = () => admin.firestore();

/**
 * POST /api/stock/update
 * Update stock quantity for an item
 */
router.post('/update', verifyFirebaseToken, requireOrg('orgId'), async (req, res) => {
  try {
    console.log('📦 Stock update request received:', req.body);
    console.log('👤 Authenticated user:', req.user);
    let { orgId, itemId, qtyChange, reason, quantity, operation } = req.body;

    // Input validation
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({
        error: {
          message: 'itemId is required and must be a string',
          status: 400
        }
      });
    }

    // Support legacy payloads: if quantity/operation provided, derive qtyChange
    let useFinalQuantityMode = false;
    if ((quantity !== undefined && quantity !== null) || operation) {
      useFinalQuantityMode = true;
    }

    // Use Firestore transaction for atomicity
    const updatedItem = await getDb().runTransaction(async (transaction) => {
      const inventoryDocRef = getDb().collection('organizations').doc(orgId).collection('inventory').doc(itemId);
      const activityLogRef = getDb().collection('organizations').doc(orgId).collection('activityLogs').doc();

      // Get current inventory item
      const inventoryDoc = await transaction.get(inventoryDocRef);
      
      if (!inventoryDoc.exists) {
        throw new Error('ITEM_NOT_FOUND');
      }

      const currentData = inventoryDoc.data();
      const currentQty = currentData.quantity || 0;

      // Derive qtyChange if needed
      if (useFinalQuantityMode) {
        // If operation is set, apply accordingly; default to 'set' when only quantity provided
        if (!operation) operation = 'set';
        if (operation === 'set') {
          qtyChange = (typeof quantity === 'number' ? quantity : currentQty) - currentQty;
        } else if (operation === 'add') {
          qtyChange = Math.abs(typeof quantity === 'number' ? quantity : 0);
        } else if (operation === 'subtract') {
          qtyChange = -Math.abs(typeof quantity === 'number' ? quantity : 0);
        }
      }

      // Validate qtyChange now
      if (typeof qtyChange !== 'number' || isNaN(qtyChange)) {
        return res.status(400).json({
          error: {
            message: 'qtyChange is required and must be a valid number (or provide quantity/operation)',
            status: 400
          }
        });
      }

      if (qtyChange === 0) {
        return res.status(400).json({
          error: {
            message: 'qtyChange cannot be zero',
            status: 400
          }
        });
      }
      const newQty = currentQty + qtyChange;

      // Prevent negative quantities
      if (newQty < 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      // Update inventory document
      const updateData = {
        quantity: newQty,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdatedBy: {
          uid: req.user.uid,
          email: req.user.email
        }
      };

      transaction.update(inventoryDocRef, updateData);

      // Create activity log entry matching dashboard schema
      const activityData = {
        organizationId: orgId,
        user: req.user.email, // dashboard expects email here
        action: 'Stock Update',
        details: {
          itemId: itemId,
          itemName: currentData.name || 'Unknown Item',
          change: {
            field: 'stock',
            from: currentQty,
            to: newQty
          },
          metadata: {
            userId: req.user.uid,
            userRole: (req.user.roles && req.user.roles[0]) || 'user',
            reason: reason || null,
            importSource: 'dashboard'
          }
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };

      transaction.set(activityLogRef, activityData);

      // Also create a frontend-compatible notification in Firestore
      const notificationRef = getDb().collection('organizations').doc(orgId).collection('notifications').doc();
      const notificationData = {
        type: 'stock',
        title: 'Stock Updated (API)',
        message: `${currentData.name || itemId} was ${qtyChange > 0 ? 'restocked' : 'reduced'} by ${req.user.email} (${qtyChange > 0 ? '+' : ''}${qtyChange})`,
        targetUserId: 'ALL',
        priority: Math.abs(qtyChange) > 10 ? 'high' : 'normal',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        readBy: [],
        metadata: {
          itemId,
          qtyChange,
          user: req.user.email,
          source: 'backend-api'
        }
      };
      transaction.set(notificationRef, notificationData);

      // Return updated item data for response
      return {
        id: itemId,
        ...currentData,
        ...updateData,
        quantity: newQty // Ensure we return the computed value
      };
    });

    // Send FCM notification after successful transaction
    try {
      const action = qtyChange > 0 ? 'added' : 'removed';
      const itemName = updatedItem.name || updatedItem.itemName || itemId;
      
      console.log(`📢 Sending FCM stock activity notification for org: ${orgId}, item: ${itemName}, change: ${qtyChange}`);
      
      await sendStockActivityNotification(
        orgId,
        itemName,
        qtyChange,
        req.user.email,
        action
      );

      console.log(`✅ FCM stock update notification sent for org: ${orgId}, item: ${itemId}`);
    } catch (notificationError) {
      console.warn(`⚠️ FCM notification failed for stock update in org ${orgId}:`, notificationError.message);
      // Don't fail the entire request for notification issues
    }

    console.log(`✅ Stock updated: ${itemId} in org ${orgId}, change: ${qtyChange}, new qty: ${updatedItem.quantity}, by: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Stock updated successfully',
      data: {
        item: updatedItem,
        change: {
          qtyChange: qtyChange,
          reason: reason || null,
          updatedBy: req.user.email,
          timestamp: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('❌ Error updating stock:', error.message);
    
    let errorMessage = 'Failed to update stock';
    let status = 500;

    if (error.message === 'ITEM_NOT_FOUND') {
      errorMessage = 'Item not found in inventory';
      status = 404;
    } else if (error.message === 'INSUFFICIENT_STOCK') {
      errorMessage = 'Insufficient stock for this operation';
      status = 400;
    } else if (error.code === 'aborted') {
      errorMessage = 'Transaction failed due to concurrent updates. Please try again.';
      status = 409;
    }

    res.status(status).json({
      error: {
        message: errorMessage,
        status: status
      }
    });
  }
});

module.exports = router;
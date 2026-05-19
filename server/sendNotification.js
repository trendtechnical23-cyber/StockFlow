const { messaging, database } = require('./firebaseAdmin');

async function sendNotificationToUser(userUid, title, body, data = {}) {
  try {
    if (!database) {
      console.warn('⚠️ Realtime Database unavailable — skipping FCM token lookup');
      return { success: false, error: 'Realtime Database not configured' };
    }
    console.log(`🔍 Fetching FCM token for user: ${userUid}`);

    const tokenSnapshot = await database.ref(`deviceTokens/${userUid}`).get();
    const token = tokenSnapshot.val();

    if (!token) {
      console.error(`❌ No FCM token found for user ${userUid}`);
      return { success: false, error: "No FCM token found" };
    }

    console.log(`📱 Found FCM token for user ${userUid}: ${token.substring(0, 20)}...`);

    const message = {
      token,
      notification: { title, body },
      data: data || { type: "STOCK_ACTIVITY" },
    };

    const response = await messaging.send(message);
    console.log(`✅ Notification sent to ${userUid}. Message ID: ${response}`);
    
    return { success: true, messageId: response };
  } catch (error) {
    console.error(`❌ Failed to send notification to user ${userUid}:`, error);
    return { success: false, error: error.message };
  }
}

async function sendNotificationToOrg(orgId, title, body, data = {}) {
  try {
    if (!database) {
      console.warn('⚠️ Realtime Database unavailable — skipping org notification');
      return { success: false, error: 'Realtime Database not configured' };
    }
    console.log(`🏢 Sending notification to organization: ${orgId}`);

    const membersSnapshot = await database.ref(`organizations/${orgId}/members`).get();
    const members = membersSnapshot.val();

    if (!members) {
      console.error(`❌ No members found for organization ${orgId}`);
      return { success: false, error: "No organization members found" };
    }

    const memberUids = Object.keys(members);
    console.log(`👥 Found ${memberUids.length} members in org ${orgId}`);

    const results = [];
    
    // Send notification to each member
    for (const memberUid of memberUids) {
      const result = await sendNotificationToUser(memberUid, title, body, data);
      results.push({ uid: memberUid, result });
    }

    const successCount = results.filter(r => r.result.success).length;
    console.log(`✅ Successfully sent ${successCount}/${memberUids.length} notifications to org ${orgId}`);

    return { 
      success: true, 
      totalMembers: memberUids.length, 
      successfulSends: successCount,
      results 
    };
  } catch (error) {
    console.error(`❌ Failed to send notifications to organization ${orgId}:`, error);
    return { success: false, error: error.message };
  }
}

async function sendStockActivityNotification(orgId, itemName, qtyChange, userEmail, action) {
  const title = "Stock Activity";
  const body = `${itemName} was ${action} by ${userEmail}. Qty change: ${qtyChange > 0 ? '+' : ''}${qtyChange}`;
  
  const data = {
    type: "STOCK_ACTIVITY",
    item_name: itemName,
    qty_change: qtyChange.toString(),
    user_email: userEmail,
    action: action
  };

  return await sendNotificationToOrg(orgId, title, body, data);
}

module.exports = {
  sendNotificationToUser,
  sendNotificationToOrg,
  sendStockActivityNotification
};
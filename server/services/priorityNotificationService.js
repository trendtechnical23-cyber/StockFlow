const admin = require('firebase-admin');
const fcmService = require('./fcmService');

const getDb = () => admin.firestore();

async function checkAndNotify() {
  console.log('Checking priority item stock levels...');
  const orgsSnapshot = await getDb().collection('organizations').get();

  for (const orgDoc of orgsSnapshot.docs) {
    const orgId = orgDoc.id;
    const priorityItemsSnapshot = await getDb().collection(`organizations/${orgId}/priorityItems`).get();

    if (priorityItemsSnapshot.empty) {
      continue;
    }

    for (const priorityDoc of priorityItemsSnapshot.docs) {
      const priorityItem = priorityDoc.data();
      const inventoryItemRef = getDb().collection(`organizations/${orgId}/inventory`).doc(priorityItem.itemId);
      const inventoryItemDoc = await inventoryItemRef.get();

      if (inventoryItemDoc.exists) {
        const inventoryItem = inventoryItemDoc.data();

        if (inventoryItem.stock < inventoryItem.threshold) {
          console.log(`Low stock for priority item ${inventoryItem.name} in org ${orgId}`);
          const message = {
            notification: {
              title: 'Priority Item Low Stock',
              body: `${inventoryItem.name} is low on stock (${inventoryItem.stock} remaining).`,
            },
            topic: orgId,
          };
          // In a real app, you might want to send to specific users
          // For now, we'll just log it.
          console.log('Would send notification:', message);
          // await fcmService.sendNotificationToOrganization(orgId, message.notification);
        }
      }
    }
  }
}

module.exports = { checkAndNotify };

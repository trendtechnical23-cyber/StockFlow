const express = require('express');
const router = express.Router();
const priorityNotificationService = require('../services/priorityNotificationService');

router.post('/check-stock', async (req, res) => {
  try {
    await priorityNotificationService.checkAndNotify();
    res.status(200).json({ message: 'Stock check initiated.' });
  } catch (error) {
    console.error('Error checking priority stock:', error);
    res.status(500).json({ error: 'Failed to check priority stock.' });
  }
});

module.exports = router;

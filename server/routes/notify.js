/**
 * Notification routes — push notification delivery is not available
 * (Firebase project has been removed). These endpoints respond gracefully
 * so the frontend can handle the absence of FCM without errors.
 */
const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');

const router = express.Router();

const unavailable = (res) =>
  res.status(503).json({
    success: false,
    message: 'Push notification service is not configured',
    reason: 'FCM requires a Firebase project. Notifications have been disabled.',
  });

router.post('/test',        verifyFirebaseToken, (req, res) => unavailable(res));
router.post('/org-test',    verifyFirebaseToken, (req, res) => unavailable(res));
router.post('/stock-test',  verifyFirebaseToken, (req, res) => unavailable(res));

module.exports = router;

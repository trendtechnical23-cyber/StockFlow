const express = require('express');
const admin = require('firebase-admin');
const { verifyFirebaseToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/admin/setUserOrg
 * Assign user to organization by setting custom claims
 */
router.post('/setUserOrg', verifyFirebaseToken, async (req, res) => {
  try {
    const { uid, orgId } = req.body;

    // Input validation
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({
        error: {
          message: 'uid is required and must be a string',
          status: 400
        }
      });
    }

    if (!orgId || typeof orgId !== 'string') {
      return res.status(400).json({
        error: {
          message: 'orgId is required and must be a string',
          status: 400
        }
      });
    }

    // Authorization check - either admin org or bootstrap secret
    const adminOrgId = process.env.ADMIN_ORG_ID;
    const isAdminUser = adminOrgId && req.user.orgId && req.user.orgId === adminOrgId;
    const adminSecret = process.env.ADMIN_SECRET;
    const isBootstrapRequest = adminSecret && req.headers['x-admin-secret'] === adminSecret;

    if (!isAdminUser && !isBootstrapRequest) {
      console.warn(`❌ Unauthorized setUserOrg attempt by user: ${req.user.email} (org: ${req.user.orgId})`);
      return res.status(403).json({
        error: {
          message: 'Access denied: Admin privileges required',
          status: 403
        }
      });
    }

    // Verify target user exists
    let targetUser;
    try {
      targetUser = await admin.auth().getUser(uid);
    } catch (error) {
      console.error(`❌ User not found: ${uid}`, error.message);
      return res.status(404).json({
        error: {
          message: 'User not found',
          status: 404
        }
      });
    }

    // Set custom claims
    await admin.auth().setCustomUserClaims(uid, { 
      orgId: orgId,
      updatedAt: Date.now()
    });

    console.log(`✅ User organization updated: ${targetUser.email} (${uid}) assigned to org: ${orgId} by admin: ${req.user.email}`);

    res.json({
      success: true,
      message: 'User organization updated successfully',
      data: {
        uid: uid,
        email: targetUser.email,
        orgId: orgId,
        updatedBy: req.user.email,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error setting user organization:', error.message);
    
    let errorMessage = 'Failed to update user organization';
    let status = 500;

    if (error.code === 'auth/user-not-found') {
      errorMessage = 'User not found';
      status = 404;
    } else if (error.code === 'auth/invalid-uid') {
      errorMessage = 'Invalid user ID format';
      status = 400;
    }

    res.status(status).json({
      error: {
        message: errorMessage,
        status: status
      }
    });
  }
});

/**
 * POST /api/admin/createUser
 * Create a new user using Firebase Admin SDK (server-side)
 * This prevents the current user from being logged out
 */
router.post('/createUser', verifyFirebaseToken, async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    // Input validation
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        error: {
          message: 'email is required and must be a string',
          status: 400
        }
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        error: {
          message: 'password is required and must be at least 6 characters',
          status: 400
        }
      });
    }

    // Authorization check - verify user is authenticated AND is admin/owner
    if (!req.user || !req.user.uid) {
      return res.status(403).json({
        error: {
          message: 'Access denied: Authentication required',
          status: 403
        }
      });
    }

    // Verify caller is admin/owner in their organization
    const callerOrgId = req.user.orgId;
    if (!callerOrgId) {
      return res.status(403).json({
        error: {
          message: 'Access denied: No organization context',
          status: 403
        }
      });
    }
    
    const callerDoc = await admin.firestore()
      .collection('organizations').doc(callerOrgId)
      .collection('users').doc(req.user.uid)
      .get();
    
    const callerRole = callerDoc.exists ? (callerDoc.data().role || '').toLowerCase() : '';
    if (!['admin', 'owner'].includes(callerRole)) {
      console.warn(`❌ Non-admin user ${req.user.email} (role: ${callerRole}) attempted createUser`);
      return res.status(403).json({
        error: {
          message: 'Access denied: Admin or Owner role required',
          status: 403
        }
      });
    }

    console.log(`👤 Creating user via Admin SDK: ${email} (requested by: ${req.user.email})`);

    // Create user using Firebase Admin SDK (server-side)
    const userRecord = await admin.auth().createUser({
      email: email.trim(),
      password: password,
      displayName: displayName || email.split('@')[0],
      emailVerified: false
    });

    console.log('✅ User created successfully via Admin SDK:', {
      uid: userRecord.uid,
      email: userRecord.email,
      requestedBy: req.user.email
    });

    // Return the created user data
    res.status(201).json({
      success: true,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        emailVerified: userRecord.emailVerified
      }
    });

  } catch (error) {
    console.error('❌ Failed to create user via Admin SDK:', error);
    
    let errorMessage = 'Failed to create user';
    let status = 500;

    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'An account with this email already exists';
      status = 409;
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email format';
      status = 400;
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Password is too weak';
      status = 400;
    }

    res.status(status).json({
      error: {
        message: errorMessage,
        status: status
      }
    });
  }
});

/**
 * DELETE /api/admin/deleteUser
 * Delete a user from Firebase Auth
 */
router.delete('/deleteUser', verifyFirebaseToken, async (req, res) => {
  try {
    const { uid } = req.body;

    // Input validation
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({
        error: {
          message: 'uid is required and must be a string',
          status: 400
        }
      });
    }

    // Authorization check - verify user is authenticated AND is admin/owner
    if (!req.user || !req.user.uid) {
      return res.status(403).json({
        error: {
          message: 'Access denied: Authentication required',
          status: 403
        }
      });
    }

    // Verify caller is admin/owner in their organization
    const callerOrgId = req.user.orgId;
    if (!callerOrgId) {
      return res.status(403).json({
        error: {
          message: 'Access denied: No organization context',
          status: 403
        }
      });
    }
    
    const callerDoc = await admin.firestore()
      .collection('organizations').doc(callerOrgId)
      .collection('users').doc(req.user.uid)
      .get();
    
    const callerRole = callerDoc.exists ? (callerDoc.data().role || '').toLowerCase() : '';
    if (!['admin', 'owner'].includes(callerRole)) {
      console.warn(`❌ Non-admin user ${req.user.email} (role: ${callerRole}) attempted deleteUser`);
      return res.status(403).json({
        error: {
          message: 'Access denied: Admin or Owner role required',
          status: 403
        }
      });
    }

    console.log(`🗑️ Deleting user from Auth: ${uid} (requested by: ${req.user.email})`);

    // Delete user from Firebase Auth
    await admin.auth().deleteUser(uid);

    console.log('✅ User deleted from Auth successfully:', uid);

    res.json({
      success: true,
      message: 'User deleted from authentication successfully',
      data: {
        uid: uid,
        deletedBy: req.user.email,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Failed to delete user from Auth:', error);
    
    let errorMessage = 'Failed to delete user';
    let status = 500;

    if (error.code === 'auth/user-not-found') {
      errorMessage = 'User not found in authentication system';
      status = 404;
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
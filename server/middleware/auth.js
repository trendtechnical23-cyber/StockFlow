const admin = require('firebase-admin');

/**
 * Verify Firebase ID token and attach user info to request
 */
const verifyFirebaseToken = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('Missing or invalid Authorization header');
      return res.status(401).json({
        error: {
          message: 'Authorization header must be provided as "Bearer <token>"',
          status: 401
        }
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      console.warn('Empty token in Authorization header');
      return res.status(401).json({
        error: {
          message: 'Token is required',
          status: 401
        }
      });
    }

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Look up user's organization from userIndex
    let userOrgId = decodedToken.orgId || null;
    
    if (!userOrgId) {
      try {
        const db = admin.firestore();
        const userIndexRef = db.collection('userIndex').doc(decodedToken.uid);
        const userIndexSnap = await userIndexRef.get();
        
        if (userIndexSnap.exists) {
          const userData = userIndexSnap.data();
          console.log(`📋 UserIndex data for ${decodedToken.email}:`, userData);
          userOrgId = userData.organizationId;
          console.log(`📋 Found organization ${userOrgId} for user ${decodedToken.email} via userIndex`);
        } else {
          console.warn(`⚠️ No userIndex entry found for user ${decodedToken.email} (uid: ${decodedToken.uid})`);
          
          // Try to find user in any organization as fallback
          console.log('🔍 Searching for user in organizations collection...');
          const orgsSnapshot = await db.collection('organizations').get();
          for (const orgDoc of orgsSnapshot.docs) {
            const usersRef = db.collection('organizations').doc(orgDoc.id).collection('users');
            const userSnap = await usersRef.doc(decodedToken.uid).get();
            if (userSnap.exists) {
              userOrgId = orgDoc.id;
              console.log(`📋 Found user in organization ${userOrgId} via fallback search`);
              break;
            }
          }
        }
      } catch (lookupError) {
        console.warn(`⚠️ Failed to lookup organization for user ${decodedToken.email}:`, lookupError.message);
      }
    }
    
    // Attach user information to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      orgId: userOrgId,
      roles: decodedToken.roles || []
    };

    console.log(`✅ Token verified for user: ${req.user.email} (org: ${req.user.orgId})`);
    next();
    
  } catch (error) {
    console.error('❌ Token verification failed:', error.message);
    
    let errorMessage = 'Invalid or expired token';
    let status = 401;
    
    if (error.code === 'auth/id-token-expired') {
      errorMessage = 'Token has expired';
    } else if (error.code === 'auth/invalid-id-token') {
      errorMessage = 'Invalid token format';
    } else if (error.code === 'auth/id-token-revoked') {
      errorMessage = 'Token has been revoked';
    }
    
    return res.status(status).json({
      error: {
        message: errorMessage,
        status: status
      }
    });
  }
};

/**
 * Require user to belong to specific organization
 * @param {string} orgIdParamName - Name of parameter containing orgId (defaults to 'orgId')
 */
const requireOrg = (orgIdParamName = 'orgId') => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        console.error('❌ requireOrg middleware called without authentication');
        return res.status(401).json({
          error: {
            message: 'Authentication required',
            status: 401
          }
        });
      }

      // Get orgId from params or body, fallback to authenticated user
      let requestedOrgId = req.params[orgIdParamName] || req.body.orgId || req.user.orgId;

      if (!requestedOrgId) {
        console.warn(`❌ Missing organization ID in ${orgIdParamName} parameter, body, and user context`);
        return res.status(400).json({
          error: {
            message: `Organization ID is required in ${orgIdParamName} parameter, request body, or user context`,
            status: 400
          }
        });
      }

      // Normalize downstream usage
      if (!req.body.orgId) {
        req.body.orgId = requestedOrgId;
      }

      if (!req.user.orgId) {
        console.warn(`❌ User ${req.user.email} has no organization assigned`);
        return res.status(403).json({
          error: {
            message: 'User is not assigned to any organization',
            status: 403
          }
        });
      }

      if (req.user.orgId && req.user.orgId !== requestedOrgId) {
        console.warn(`❌ Access denied: User ${req.user.email} (org: ${req.user.orgId}) attempted to access org: ${requestedOrgId}`);
        return res.status(403).json({
          error: {
            message: 'Access denied: You can only access resources from your own organization',
            status: 403
          }
        });
      }

      console.log(`✅ Organization access granted for user: ${req.user.email} to org: ${requestedOrgId}`);
      next();
      
    } catch (error) {
      console.error('❌ Organization verification error:', error.message);
      return res.status(500).json({
        error: {
          message: 'Internal server error during organization verification',
          status: 500
        }
      });
    }
  };
};

module.exports = {
  verifyFirebaseToken,
  requireOrg
};
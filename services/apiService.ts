import { InventoryItem, User, ActivityLogEntry, Organization, UserRole, ZohoIntegration, Subscription, AuditLedgerEntry } from '../types';
import { activityLogger } from './activityLogger';
import { broadcastActivity } from '../serverBroadcast';
import { MOCK_ZOHO_IMPORT } from '../constants';
import { ZohoService } from './zohoService';
import { API_ENDPOINTS } from '../utils/apiConfig';
import { 
  auth,
  firestore, 
  database,
  OrganizationDataService,
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  writeBatch
} from './firebase';
import { getDatabase, ref, remove } from 'firebase/database';

// --- ORGANIZATION-CENTRIC FIRESTORE API SERVICE ---
// All data is scoped to organizations for complete data isolation

const orgDataService = OrganizationDataService.getInstance();

/**
 * Clear all local data and reset the application state
 * This is called when starting fresh or switching organizations
 */
export const clearAllLocalData = async (): Promise<void> => {
  console.log('🧹 Clearing all local data for fresh start...');
  await orgDataService.clearLocalData();
};

/**
 * Create a new organization with admin user
 * This is the entry point for new registrations
 */
export const createOrganizationAndUser = async (params: { 
  name: string, 
  email: string, 
  orgName: string, 
  uid: string 
}): Promise<{ user: User, organization: Organization }> => {
  console.log('🏢 Creating organization and admin user:', params.email);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  // Clear any existing local data first
  await clearAllLocalData();

  const organizationId = `org_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const organizationData: Organization = {
    id: organizationId,
    name: params.orgName.trim(),
    plan: 'free' as const,
    createdAt: new Date(),
    ownerId: params.uid,
    settings: {
      lowStockThreshold: 10,
      currency: 'ZAR',
      timezone: 'Africa/Johannesburg'
    },
    categories: [],
    integrations: {
      zoho: {
        status: 'disconnected' as const
      }
    },
    subscription: {
      plan: 'Free' as const,
      status: 'active' as const,
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days free trial
    }
  };

  const adminUserData: User = {
    uid: params.uid,
    name: params.name.trim(),
    email: params.email.toLowerCase().trim(),
    role: UserRole.Admin,
    organizationId: organizationId
  };

  try {
    await orgDataService.createOrganization(organizationData, adminUserData);
    
    console.log(`✅ Organization '${params.orgName}' created with admin user '${params.name}'`);
    
    return {
      organization: organizationData,
      user: adminUserData
    };
  } catch (error) {
    console.error('❌ Error creating organization and user:', error);
    throw new Error(`Failed to create organization: ${error.message}`);
  }
};

/**
 * Gets user data by email across all organizations
 */
export const getUserByEmail = async (email: string): Promise<{ 
  user: User, 
  organization: Organization, 
  inventoryCount: number 
} | null> => {
  console.log('👤 Getting user data by email:', email);
  
  if (!firestore) {
    console.warn('Firestore not initialized');
    return null;
  }

  // Check if user is authenticated - required for searching organizations
  if (!auth.currentUser) {
    console.log('⚠️ getUserByEmail requires authentication - skipping');
    return null;
  }

  try {
    // --- Fast path using email index (migration safe) ---
    try {
      const emailKey = email.toLowerCase();
      const sanitizedKey = emailKey.replace(/[^a-z0-9@._-]/g, '_');
      const emailIndexRef = doc(collection(firestore, 'userEmailIndex'), sanitizedKey);
      const emailIndexSnap = await getDoc(emailIndexRef);
      if (emailIndexSnap.exists()) {
        const { organizationId, uid } = emailIndexSnap.data() as any;
        if (organizationId && uid) {
          const userRef = doc(orgDataService.getOrgCollection(organizationId, 'users'), uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const orgRef = doc(firestore, 'organizations', organizationId);
              const orgSnap = await getDoc(orgRef);
              if (orgSnap.exists()) {
                const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
                const inventorySnapshot = await getDocs(inventoryRef);
                const inventoryCount = inventorySnapshot.docs.filter(d => d.id !== '_init').length;
                return {
                  user: {
                    uid: userSnap.id,
                    name: userSnap.data().name,
                    email: userSnap.data().email,
                    role: userSnap.data().role,
                    organizationId
                  } as User,
                  organization: {
                    id: orgSnap.id,
                    name: orgSnap.data().name,
                    categories: orgSnap.data().categories || [],
                    integrations: orgSnap.data().integrations || { zoho: { status: 'disconnected' } },
                    subscription: orgSnap.data().subscription || { plan: 'Free', status: 'active' }
                  } as Organization,
                  inventoryCount
                };
              }
            }
        }
      }
    } catch (fastErr) {
      console.log('⚠️ Email index fast-path failed:', fastErr.message);
    }

    // NO FALLBACK - never search across organizations
    // If email index doesn't exist, user doesn't exist
    console.log('👤 No user found with email (email index missing):', email);
    return null;
  } catch (error) {
    console.error('❌ Error getting user data by email:', error);
    return null;
  }
};

/**
 * Get user data and organization information
 * Validates user belongs to organization
 */
export const getUserData = async (uid: string): Promise<{ 
  user: User, 
  organization: Organization, 
  inventoryCount: number 
} | null> => {
  console.log('👤 Getting user data for UID:', uid);
  
  if (!firestore) {
    console.warn('Firestore not initialized');
    return null;
  }

  try {
    // --- Fast path using userIndex (migration safe) with a quick retry for propagation ---
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const userIndexRef = doc(collection(firestore, 'userIndex'), uid);
        const userIndexSnap = await getDoc(userIndexRef);
        if (userIndexSnap.exists()) {
          console.log('📋 Found userIndex entry:', userIndexSnap.data());
          const { organizationId } = userIndexSnap.data() as any;
          if (organizationId) {
            console.log('🏢 Looking up user in organization:', organizationId);
            const userRef = doc(orgDataService.getOrgCollection(organizationId, 'users'), uid);
            const orgRef = doc(firestore, 'organizations', organizationId);
            const [userSnap, orgSnap] = await Promise.all([getDoc(userRef), getDoc(orgRef)]);

            if (userSnap.exists() && orgSnap.exists()) {
              console.log('👤 Found user document:', userSnap.data());
              console.log('🏢 Found organization document:', orgSnap.data());
              const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
              const inventorySnapshot = await getDocs(inventoryRef);
              const inventoryCount = inventorySnapshot.docs.filter(d => d.id !== '_init').length;
              return {
                user: {
                  uid: userSnap.id,
                  name: userSnap.data().name,
                  email: userSnap.data().email,
                  role: userSnap.data().role,
                  organizationId,
                  onboardingCompleted: userSnap.data().onboardingCompleted
                } as User,
                organization: {
                  id: orgSnap.id,
                  name: orgSnap.data().name,
                  categories: orgSnap.data().categories || [],
                  integrations: orgSnap.data().integrations || { zoho: { status: 'disconnected' } },
                  subscription: orgSnap.data().subscription || { plan: 'Free', status: 'active' }
                } as Organization,
                inventoryCount
              };
            }

            console.warn('🧹 Stale userIndex entry detected for UID:', uid, 'Cleaning up...');
            await deleteDoc(userIndexRef);
          } else {
            console.warn('🧹 userIndex entry missing organizationId for UID:', uid, 'Cleaning up...');
            await deleteDoc(userIndexRef);
          }
        }
      } catch (fastErr: any) {
        console.log('⚠️ userIndex fast-path failed (attempt', attempt, '):', fastErr?.message);
        if (attempt < 2) {
          // Small delay to allow Firestore commit/propagation
          await new Promise(res => setTimeout(res, 800));
          continue;
        }
        console.log('⚠️ Fast path error details:', fastErr);
      }
      break;
    }

    // NO FALLBACK - never search across organizations
    // If userIndex doesn't exist, user setup is incomplete
    console.log('👤 No userIndex found for UID (user setup incomplete):', uid);
    return null;
  } catch (error) {
    console.error('❌ Error getting user data:', error);
    return null;
  }
};

/**
 * Mark onboarding as completed for a user (persisted in Firestore)
 */
export const markOnboardingComplete = async (organizationId: string, uid: string): Promise<void> => {
  if (!firestore) return;
  const userRef = doc(orgDataService.getOrgCollection(organizationId, 'users'), uid);
  try {
    await updateDoc(userRef, { onboardingCompleted: true });
  } catch (err) {
    console.warn('⚠️ Failed to mark onboarding complete (non-blocking):', (err as any)?.message);
  }
};

/**
 * Get all data for a user's organization
 */
export const getOrganizationData = async (organizationId: string): Promise<{
  inventory: InventoryItem[],
  users: User[],
  activityLogs: ActivityLogEntry[]
}> => {
  console.log('🏢 Loading organization data:', organizationId);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const data = await orgDataService.getAllOrganizationData(organizationId);
    console.log(`✅ Loaded ${data.inventory.length} items, ${data.users.length} users, ${data.activityLogs.length} logs`);
    return {
      inventory: data.inventory.map((doc: any) => ({
        id: doc.id,
        organizationId: doc.organizationId,
        name: doc.name || '',
        sku: doc.sku || '',
        category: doc.category || '', // Leave blank if no category
        stock: doc.stock || 0,
        threshold: doc.threshold || 10,
        supplier: doc.supplier || '',
        description: doc.description || '',
        unit: doc.unit,
        cost: doc.cost,
        price: doc.price,
        currency: doc.currency,
        lastModified: doc.lastModified,
        lastSynced: doc.lastSynced,
        syncStatus: doc.syncStatus,
        source: doc.source || 'manual',
        zohoId: doc.zohoId,
        lastUsed: doc.lastUsed,
        usageCount: doc.usageCount,
        totalUsed: doc.totalUsed,
        // Required properties from firebase.ts
        isActive: doc.isActive ?? true,
        priority: doc.priority ?? false,
        lastUsedAt: doc.lastUsedAt || new Date(),
        lastModifiedAt: doc.lastModifiedAt || new Date(),
        metadata: doc.metadata || {}
      })) as InventoryItem[],
      users: data.users.map((doc: any) => ({
        uid: doc.uid,
        name: doc.name,
        email: doc.email,
        role: doc.role,
        organizationId: doc.organizationId
      })) as User[],
      activityLogs: data.activityLogs.map((doc: any) => ({
        id: doc.id,
        organizationId: doc.organizationId,
        user: doc.user,
        action: doc.action,
        // Normalize Firestore Timestamp -> ISO string; fallback to createdAt or now
        timestamp: (doc.timestamp && typeof doc.timestamp?.toDate === 'function')
          ? doc.timestamp.toDate().toISOString()
          : (typeof doc.timestamp === 'string' && doc.timestamp)
            ? doc.timestamp
            : (doc.createdAt && typeof doc.createdAt?.toDate === 'function')
              ? doc.createdAt.toDate().toISOString()
              : (typeof doc.createdAt === 'string' ? doc.createdAt : new Date().toISOString()),
        details: doc.details
      })) as ActivityLogEntry[]
    };
  } catch (error) {
    console.error('❌ Error loading organization data:', error);
    throw error;
  }
};

/**
 * Add inventory item to organization
 */
export const addInventoryItem = async (item: Omit<InventoryItem, 'id'>, organizationId: string): Promise<InventoryItem> => {
  console.log('📦 Adding inventory item:', item.name);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
    
    // Clean the item data by removing undefined values (Firestore doesn't allow them)
    const cleanedItem = Object.fromEntries(
      Object.entries(item).filter(([_, value]) => value !== undefined)
    );
    
    const docRef = await addDoc(inventoryRef, {
      ...cleanedItem,
      organizationId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const newItem: InventoryItem = {
      ...item,
      id: docRef.id,
      organizationId
    };

  console.log('✅ Inventory item added:', newItem.id);
  try { broadcastActivity(organizationId, { id: newItem.id, organizationId, user: auth?.currentUser?.email || 'system', action: `Added item: ${newItem.name}`, timestamp: new Date().toISOString(), type: 'INVENTORY_ADD', payload: { itemId: newItem.id, name: newItem.name, stock: newItem.stock } }); } catch {}
    return newItem;
  } catch (error) {
    console.error('❌ Error adding inventory item:', error);
    throw error;
  }
};

/**
 * Update inventory item
 */
export const updateInventoryItem = async (item: InventoryItem, organizationId: string): Promise<void> => {
  console.log('📦 Updating inventory item:', item.id);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const itemRef = doc(orgDataService.getOrgCollection(organizationId, 'inventory'), item.id);
    
    // Clean the item data by removing undefined values (Firestore doesn't allow them)
    const cleanedItem = Object.fromEntries(
      Object.entries(item).filter(([_, value]) => value !== undefined)
    );
    
    await updateDoc(itemRef, {
      ...cleanedItem,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Inventory item updated:', item.id);
  try { broadcastActivity(organizationId, { id: item.id, organizationId, user: auth?.currentUser?.email || 'system', action: `Updated item: ${item.name}`, timestamp: new Date().toISOString(), type: 'INVENTORY_UPDATE', payload: { itemId: item.id } }); } catch {}
  } catch (error) {
    console.error('❌ Error updating inventory item:', error);
    throw error;
  }
};

/**
 * Delete inventory item
 */
export const deleteInventoryItem = async (itemId: string, organizationId: string): Promise<void> => {
  console.log('🗑️ Deleting inventory item:', itemId);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const itemRef = doc(orgDataService.getOrgCollection(organizationId, 'inventory'), itemId);
    await deleteDoc(itemRef);
    
  console.log('✅ Inventory item deleted:', itemId);
  try { broadcastActivity(organizationId, { id: itemId, organizationId, user: auth?.currentUser?.email || 'system', action: `Deleted item: ${itemId}`, timestamp: new Date().toISOString(), type: 'INVENTORY_DELETE', payload: { itemId } }); } catch {}
  } catch (error) {
    console.error('❌ Error deleting inventory item:', error);
    throw error;
  }
};

/**
 * Add existing Firebase Auth user to organization
 */
export const addExistingUserToOrganization = async (
  email: string,
  organizationId: string,
  role: 'Admin' | 'Manager' | 'User' = 'User'
): Promise<User> => {
  console.log('👥 Adding existing user to organization:', email, 'with role:', role);
  
  if (!firestore || !auth) {
    throw new Error('Firebase not initialized');
  }

  try {
    // Check if user already exists in this organization
    const usersRef = orgDataService.getOrgCollection(organizationId, 'users');
    const emailQuery = query(usersRef, where('email', '==', email.toLowerCase()));
    const emailSnap = await getDocs(emailQuery);
    
    if (!emailSnap.empty) {
      throw new Error('This user is already part of your organization');
    }

    // Create a placeholder user record that will be activated when they login
    const tempUid = `invited_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const newUser: User = {
      uid: tempUid,
      name: email.split('@')[0], // Use email prefix as default name
      email: email.toLowerCase().trim(),
      role: role as any,
      organizationId,
      invited: true, // Mark as invited
      invitedAt: new Date().toISOString()
    };

    // Add user placeholder to organization
    const userRef = doc(usersRef, tempUid);
    await setDoc(userRef, {
      ...newUser,
      createdAt: serverTimestamp()
    });

    // Create email index entry for quick lookup
    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
    const emailIndexRef = doc(collection(firestore, 'userEmailIndex'), emailKey);
    await setDoc(emailIndexRef, {
      organizationId,
      uid: tempUid,
      inviteStatus: 'pending'
    });

    console.log('✅ User invited to organization:', email);
    try { 
      broadcastActivity(organizationId, { 
        action: `User invited: ${email} (${role})`, 
        type: 'USER_INVITE', 
        user: auth?.currentUser?.email, 
        payload: { email, role } 
      }); 
    } catch {}
    
    return newUser;
  } catch (error: any) {
    console.error('❌ Error inviting user to organization:', error);
    throw error;
  }
};

/**
 * Add user to organization (for admin creating employees)
 */
export const createUserWithOrganization = async (
  userData: Omit<User, 'organizationId' | 'uid'>, 
  organizationId: string, 
  password?: string
): Promise<User> => {
  console.log('👥 Creating user with organization:', userData.email);
  
  if (!firestore || !auth) {
    throw new Error('Firebase not initialized');
  }

  try {
    // Check if email already exists in this organization
    const usersRef = orgDataService.getOrgCollection(organizationId, 'users');
    const emailQuery = query(usersRef, where('email', '==', userData.email.toLowerCase()));
    const emailSnap = await getDocs(emailQuery);
    
    if (!emailSnap.empty) {
      throw new Error('A user with this email already exists in your organization');
    }

    let uid: string;
    
    if (password) {
      // Create user via backend API to prevent auto-login
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          throw new Error('Authentication token not available');
        }

        const response = await fetch(API_ENDPOINTS.createUser, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            email: userData.email.trim(),
            password: password,
            displayName: userData.name || userData.email.split('@')[0]
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to create user account');
        }

        const result = await response.json();
        uid = result.user.uid;
        
        console.log('✅ User account created via backend API:', userData.email);
      } catch (error) {
        console.error('❌ Backend user creation failed, falling back to invite-only:', error);
        // Fallback to invite-only user if backend creation fails
        uid = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log('⚠️ Created invite-only user due to backend error');
      }
    } else {
      // Generate temporary UID for invite-only users
      uid = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    const newUser: User = {
      ...userData,
      uid,
      organizationId,
      email: userData.email.toLowerCase().trim()
    };

    // Add user to organization
    const userRef = doc(usersRef, uid);
    await setDoc(userRef, {
      ...newUser,
      createdAt: serverTimestamp()
    });

    // Create userIndex entry for fast lookups
    const userIndexRef = doc(collection(firestore, 'userIndex'), uid);
    await setDoc(userIndexRef, {
      organizationId,
      email: newUser.email,
      role: newUser.role || 'User', // needed for isOrgAdmin rule checks for this user
      createdAt: serverTimestamp()
    });
    console.log('📋 Created userIndex entry for:', newUser.email);

    // Update organization user count
    const orgRef = orgDataService.getOrgDoc(organizationId);
    const orgSnap = await getDoc(orgRef);
    if (orgSnap.exists()) {
      const currentCount = orgSnap.data().userCount || 0;
      await updateDoc(orgRef, {
        userCount: currentCount + 1,
        updatedAt: serverTimestamp()
      });
    }

  console.log('✅ User created and added to organization:', userData.email);
    
    // Log user creation activity
    try {
      await activityLogger.logUserCreation(
        organizationId, 
        userData.email, 
        userData.role,
        auth.currentUser?.email || 'system'
      );
    } catch (logError) {
      console.warn('⚠️ Failed to log user creation:', logError);
    }
    
    return newUser;
  } catch (error: any) {
    console.error('❌ Error creating user with organization:', error);
    throw error;
  }
};

export const addUserToOrganization = async (userData: Omit<User, 'organizationId'>, organizationId: string): Promise<User> => {
  console.log('👥 Adding user to organization:', userData.email);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const userRef = doc(orgDataService.getOrgCollection(organizationId, 'users'), userData.uid);
    const newUser: User = {
      ...userData,
      organizationId
    };

    await setDoc(userRef, {
      ...newUser,
      createdAt: serverTimestamp()
    });

    // Update organization user count
    const orgRef = orgDataService.getOrgDoc(organizationId);
    const orgSnap = await getDoc(orgRef);
    if (orgSnap.exists()) {
      const currentCount = orgSnap.data().userCount || 0;
      await updateDoc(orgRef, {
        userCount: currentCount + 1,
        updatedAt: serverTimestamp()
      });
    }

  console.log('✅ User added to organization:', userData.email);
    return newUser;
  } catch (error) {
    console.error('❌ Error adding user to organization:', error);
    throw error;
  }
};

/**
 * Update user in organization
 */
export const updateUserInOrganization = async (user: User): Promise<void> => {
  console.log('👤 Updating user:', user.email);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const userRef = doc(orgDataService.getOrgCollection(user.organizationId, 'users'), user.uid);
    await updateDoc(userRef, {
      ...user,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ User updated:', user.email);
  } catch (error) {
    console.error('❌ Error updating user:', error);
    throw error;
  }
};

/**
 * Remove user from organization
 */
export const removeUserFromOrganization = async (userId: string, organizationId: string): Promise<void> => {
  console.log('🗑️ Removing user from organization:', userId);
  
  if (!firestore || !auth) {
    throw new Error('Firestore not initialized');
  }

  try {
    // Get user email before deletion for activity log
    const userRef = doc(orgDataService.getOrgCollection(organizationId, 'users'), userId);
    const userSnap = await getDoc(userRef);
    const userEmail = userSnap.exists() ? userSnap.data().email : userId;

    // Log user deletion activity
    try {
      await activityLogger.logUserDeletion(
        organizationId, 
        userEmail, 
        auth.currentUser?.email || 'system'
      );
    } catch (logError) {
      console.warn('⚠️ Failed to log user deletion:', logError);
    }
    
    // Log user deletion activity
    try {
      await activityLogger.logUserDeletion(
        organizationId, 
        userEmail, 
        auth.currentUser?.email || 'system'
      );
    } catch (logError) {
      console.warn('⚠️ Failed to log user deletion:', logError);
    }

    // Delete user from Firebase Auth (skip temp users)
    if (!userId.startsWith('temp_')) {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) {
          await fetch(API_ENDPOINTS.createUser.replace('/createUser', '/deleteUser'), {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ uid: userId })
          });
          console.log('✅ User deleted from Firebase Auth:', userId);
        }
      } catch (authError) {
        console.warn('⚠️ Failed to delete user from Auth (may not exist):', authError);
      }
    }

    // Delete user document from Firestore
    await deleteDoc(userRef);

    // Delete userIndex entry
    const userIndexRef = doc(collection(firestore, 'userIndex'), userId);
    await deleteDoc(userIndexRef);
    console.log('📋 Deleted userIndex entry for:', userId);

    // Delete member entry from Realtime Database
    try {
      const database = getDatabase();
      const memberRef = ref(database, `organizations/${organizationId}/members/${userId}`);
      await remove(memberRef);
      console.log('👥 Deleted member entry from RTDB for:', userId);
    } catch (rtdbError) {
      console.warn('⚠️ Failed to delete member from RTDB:', rtdbError);
      // Don't fail the entire deletion if RTDB cleanup fails
    }

    // Update organization user count
    const orgRef = orgDataService.getOrgDoc(organizationId);
    const orgSnap = await getDoc(orgRef);
    if (orgSnap.exists()) {
      const currentCount = orgSnap.data().userCount || 1;
      await updateDoc(orgRef, {
        userCount: Math.max(0, currentCount - 1),
        updatedAt: serverTimestamp()
      });
    }
    
    console.log('✅ User removed from organization:', userId);
  } catch (error) {
    console.error('❌ Error removing user from organization:', error);
    throw error;
  }
};

/**
 * Add activity log entry to organization
 */
export const addLogAPI = async (logEntry: Omit<ActivityLogEntry, 'id' | 'timestamp' | 'organizationId'>, organizationId: string): Promise<void> => {
  if (!firestore) {
    console.warn('Firestore not initialized, skipping log entry');
    return;
  }

  try {
    const logsRef = orgDataService.getOrgCollection(organizationId, 'activityLogs');
    const userName = String(logEntry.user || 'System');
    const docRef = await addDoc(logsRef, {
      ...logEntry,
      user: userName,
      organizationId,
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString()
    });
    try { broadcastActivity(organizationId, { id: docRef.id, organizationId, user: userName, action: logEntry.action, timestamp: new Date().toISOString(), type: 'SYSTEM', payload: logEntry.details || null }); } catch {}
  } catch (error) {
    console.error('❌ Error adding activity log:', error);
    // Don't throw error for logs to prevent disrupting main functionality
  }
};

/**
 * Update activity logs with archive status (bulk update)
 */
export const updateActivityLogsAPI = async (organizationId: string, updates: { id: string; archived?: boolean; archivedAt?: string }[]): Promise<void> => {
  if (!firestore) {
    console.warn('Firestore not initialized, skipping activity log updates');
    return;
  }

  try {
    console.log(`📁 Updating ${updates.length} activity logs with archive status...`);
    const logsRef = orgDataService.getOrgCollection(organizationId, 'activityLogs');
    
    // Update logs in batches for better performance
    const batch = writeBatch(firestore);
    
    updates.forEach(update => {
      const logDocRef = doc(logsRef, update.id);
      const updateData: any = { updatedAt: serverTimestamp() };
      
      if (update.archived !== undefined) {
        updateData.archived = update.archived;
      }
      if (update.archivedAt !== undefined) {
        updateData.archivedAt = update.archivedAt;
      }
      
      batch.update(logDocRef, updateData);
    });
    
    await batch.commit();
    console.log(`✅ Successfully updated ${updates.length} activity logs`);
  } catch (error) {
    console.error('❌ Error updating activity logs:', error);
    // Don't throw error for logs to prevent disrupting main functionality
  }
};

/**
 * Update organization settings
 */
export const updateOrganizationSettings = async (organizationId: string, settings: any): Promise<void> => {
  console.log('⚙️ Updating organization settings:', organizationId);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const orgRef = orgDataService.getOrgDoc(organizationId);
    await updateDoc(orgRef, {
      settings: settings,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Organization settings updated');
  } catch (error) {
    console.error('❌ Error updating organization settings:', error);
    throw error;
  }
};

/**
 * Update organization integrations
 */
export const updateOrganizationIntegrations = async (organizationId: string, integrations: any): Promise<void> => {
  console.log('🔗 Updating organization integrations:', organizationId);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const orgRef = orgDataService.getOrgDoc(organizationId);
    await updateDoc(orgRef, {
      integrations: integrations,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Organization integrations updated');
  } catch (error) {
    console.error('❌ Error updating organization integrations:', error);
    throw error;
  }
};

// --- LEGACY FUNCTIONS (kept for compatibility) ---

export const getInventory = async (): Promise<InventoryItem[]> => {
  console.warn('⚠️ getInventory() is deprecated. Use getOrganizationData() instead.');
  return [];
};

export const getUsers = async (): Promise<User[]> => {
  console.warn('⚠️ getUsers() is deprecated. Use getOrganizationData() instead.');
  return [];
};

export const getLogs = async (): Promise<ActivityLogEntry[]> => {
  console.warn('⚠️ getLogs() is deprecated. Use getOrganizationData() instead.');
  return [];
};

// Keep existing Zoho integration functions (they work within organization context)
export const importFromZoho = async (itemsToImport: any[], organizationId: string): Promise<InventoryItem[]> => {
  console.log('📥 Importing items from Zoho Books:', itemsToImport.length);

  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    // Validate Zoho integration and env before writing anything
    const orgRef = orgDataService.getOrgDoc(organizationId);
    const orgSnap = await getDoc(orgRef);
    if (!orgSnap.exists()) {
      throw new Error('Organization not found');
    }
    const integrations = (orgSnap.data() as any).integrations || { zoho: { status: 'disconnected' } };
    const zohoStatus = integrations.zoho?.status || 'disconnected';
    if (zohoStatus !== 'connected') {
      console.warn('⛔ Zoho import blocked: integration not connected for org', organizationId);
      throw new Error('Zoho is not connected. Please connect your Zoho account first in Integrations.');
    }
    if (!ZohoService.isConfigured()) {
      console.warn('⛔ Zoho import blocked: credentials not configured in environment');
      throw new Error('Zoho credentials are not configured. Please set VITE_ZOHO_* env vars and reconnect.');
    }

    // Transform Zoho items to standard format
    const items: Omit<InventoryItem, 'id'>[] = itemsToImport.map((zohoItem) => {
      const lastModifiedTime = zohoItem.last_modified_time || new Date().toISOString();
      
      // Debug: Log first item to see what Zoho sends
      if (itemsToImport.indexOf(zohoItem) === 0) {
        console.log('🔍 Sample Zoho item data:', {
          name: zohoItem.name,
          last_modified_time: zohoItem.last_modified_time,
          purchase_rate: zohoItem.purchase_rate,
          rate: zohoItem.rate,
          stock_on_hand: zohoItem.stock_on_hand
        });
      }
      
      return {
        name: zohoItem.name || 'Unknown Item',
        sku: zohoItem.sku || zohoItem.item_id || '',
        category: zohoItem.category_name || '', // Leave blank if no category from Zoho
        stock: parseInt(zohoItem.stock_on_hand) || 0,
        threshold: 10,
        description: zohoItem.description || '',
        unit: zohoItem.unit || 'pcs',
        cost: parseFloat(zohoItem.purchase_rate) || 0, // Cost = what you PAY (purchase_rate)
        price: parseFloat(zohoItem.rate) || 0, // Selling price = what customer PAYS (rate)
        supplier: zohoItem.vendor_name || 'Unknown',
        organizationId: organizationId,
        source: 'zoho' as const,
        lastModified: lastModifiedTime,
        lastUsed: lastModifiedTime, // Use Zoho's last modified as usage indicator
        usageCount: 0,
        // Required properties from firebase.ts
        isActive: true,
        priority: false,
        lastUsedAt: new Date(lastModifiedTime),
        lastModifiedAt: new Date(lastModifiedTime),
        metadata: {
          description: zohoItem.description || ''
        }
      };
    });

    // Check for duplicates by SKU and handle them
    const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
    const existingSnapshot = await getDocs(inventoryRef);
    const existingItems = new Map<string, { id: string; data: any }>();
    
    existingSnapshot.docs.forEach(doc => {
      if (doc.id !== '_init') {
        const data = doc.data();
        if (data.sku) {
          existingItems.set(data.sku.toLowerCase(), { id: doc.id, data });
        }
      }
    });
    
    // Separate new items from updates
    const newItems: Omit<InventoryItem, 'id'>[] = [];
    const updateItems: { id: string; data: Omit<InventoryItem, 'id'> }[] = [];
    const duplicateWarnings: string[] = [];
    
    items.forEach((item) => {
      const existingItem = existingItems.get(item.sku.toLowerCase());
      if (existingItem) {
        // Preserve locally-tracked stock and threshold — never let a Zoho fetch overwrite them.
        // Only sync metadata (name, price, cost, category, barcode) from Zoho.
        const preservedItem = {
          ...item,
          stock: existingItem.data.stock ?? item.stock,
          threshold: existingItem.data.threshold ?? item.threshold,
        };
        updateItems.push({ id: existingItem.id, data: preservedItem });
        duplicateWarnings.push(`SKU "${item.sku}" - ${item.name}`);
      } else {
        newItems.push(item);
      }
    });
    
    // Save items to Firestore in batches
    const batch = writeBatch(firestore);
    const importedItems: InventoryItem[] = [];
    
    // Add new items
    newItems.forEach((item) => {
      const docRef = doc(inventoryRef);
      batch.set(docRef, {
        ...item,
        id: docRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      importedItems.push({ ...item, id: docRef.id });
    });
    
    // Update existing items (overwrite duplicates)
    updateItems.forEach(({ id, data }) => {
      const docRef = doc(inventoryRef, id);
      batch.update(docRef, {
        ...data,
        updatedAt: serverTimestamp()
      });

      importedItems.push({ ...data, id });
    });
    
    await batch.commit();
    
    // Log duplicate handling
    if (duplicateWarnings.length > 0) {
      console.log(`⚠️ Overwritten ${duplicateWarnings.length} duplicate items from Zoho:`, duplicateWarnings.slice(0, 5));
    }
    
    console.log(`✅ Zoho import completed: ${newItems.length} new, ${updateItems.length} updated`);
    
    // Return items with metadata about duplicates
    const result = importedItems as any;
    result._duplicatesOverwritten = duplicateWarnings.length;
    result._duplicateItems = duplicateWarnings.slice(0, 10);
    
    return result;
  } catch (error) {
    console.error('❌ Error importing from Zoho:', error);
    throw error;
  }
};

/**
 * Import items from a POS system into Firestore.
 * Items come pre-mapped from the backend adapter; we just persist them.
 */
export const importFromPos = async (mappedItems: any[], organizationId: string): Promise<InventoryItem[]> => {
  console.log('📥 Importing items from POS:', mappedItems.length);

  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
    const existingSnapshot = await getDocs(inventoryRef);
    const existingItems = new Map<string, { id: string; data: any }>();

    existingSnapshot.docs.forEach(d => {
      if (d.id !== '_init') {
        const data = d.data();
        if (data.sku) {
          existingItems.set(data.sku.toLowerCase(), { id: d.id, data });
        }
      }
    });

    const newItems: any[] = [];
    const updateItems: { id: string; data: any }[] = [];
    const duplicateWarnings: string[] = [];

    mappedItems.forEach((item) => {
      const firestoreItem = {
        ...item,
        organizationId,
        isActive: true,
        priority: false,
        lastUsedAt: new Date(),
        lastModifiedAt: new Date(),
        metadata: item.metadata || { description: '', unit: '', location: '' },
      };
      const existing = existingItems.get(item.sku.toLowerCase());
      if (existing) {
        // Preserve locally-tracked stock and threshold — never let a POS fetch overwrite them.
        // Only sync metadata (name, price, cost, category, posId, barcode) from the POS.
        const preservedItem = {
          ...firestoreItem,
          stock: existing.data.stock ?? firestoreItem.stock,
          threshold: existing.data.threshold ?? firestoreItem.threshold,
        };
        updateItems.push({ id: existing.id, data: preservedItem });
        duplicateWarnings.push(`SKU "${item.sku}" - ${item.name}`);
      } else {
        newItems.push(firestoreItem);
      }
    });

    const batch = writeBatch(firestore);
    const importedItems: InventoryItem[] = [];

    newItems.forEach((item) => {
      const docRef = doc(inventoryRef);
      batch.set(docRef, { ...item, id: docRef.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      importedItems.push({ ...item, id: docRef.id });
    });

    updateItems.forEach(({ id, data }) => {
      const docRef = doc(inventoryRef, id);
      batch.update(docRef, { ...data, updatedAt: serverTimestamp() });
      importedItems.push({ ...data, id });
    });

    await batch.commit();

    if (duplicateWarnings.length > 0) {
      console.log(`⚠️ Overwritten ${duplicateWarnings.length} duplicate items from POS:`, duplicateWarnings.slice(0, 5));
    }

    console.log(`✅ POS import completed: ${newItems.length} new, ${updateItems.length} updated`);

    const result = importedItems as any;
    result._duplicatesOverwritten = duplicateWarnings.length;
    result._duplicateItems = duplicateWarnings.slice(0, 10);
    return result;
  } catch (error) {
    console.error('❌ Error importing from POS:', error);
    throw error;
  }
};

export const getZohoItems = async (organizationId: string): Promise<any[]> => {
  try {
    console.log('📥 Fetching Zoho items from backend for org:', organizationId);
    
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Not authenticated');

    // Call the backend API to get items using stored tokens
    const response = await fetch(API_ENDPOINTS.zohoItems(organizationId), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `Failed to fetch Zoho items: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'Failed to fetch Zoho items');
    }

    console.log('✅ Zoho items fetched successfully:', data.data.count, 'items');
    return data.data.items;
  } catch (error) {
    console.error('❌ Error fetching Zoho items:', error);
    throw error;
  }
};

/**
 * Sync invoice usage data - tracks when items were last sold (invoiced)
 */
export const syncInvoiceUsage = async (organizationId: string): Promise<{ itemsUpdated: number; invoicesProcessed: number }> => {
  try {
    console.log('🧾 Syncing invoice usage data for org:', organizationId);
    
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(API_ENDPOINTS.zohoSyncInvoices, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ orgId: organizationId })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to sync invoice usage');
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'Failed to sync invoice usage');
    }

    console.log('✅ Invoice usage synced:', data.data.itemsUpdated, 'items updated from', data.data.invoicesProcessed, 'invoices');
    return data.data;
  } catch (error) {
    console.error('❌ Error syncing invoice usage:', error);
    throw error;
  }
};

export const testZohoConnection = async (): Promise<boolean> => {
  try {
    console.log('🔗 Testing Zoho connection (mock test)');
    return true;
  } catch (error) {
    console.error('❌ Zoho connection test failed:', error);
    return false;
  }
};

// --- MISSING FUNCTIONS (TODO: Implement properly) ---

export const syncWithZoho = async (organizationId: string): Promise<{itemsUpdated: number, error?: string}> => {
  console.log('🔄 Starting Zoho sync for organization:', organizationId);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    // Get organization
    const orgRef = orgDataService.getOrgDoc(organizationId);
    const orgSnap = await getDoc(orgRef);
    
    if (!orgSnap.exists()) {
      throw new Error('Organization not found');
    }
    
    const orgData = orgSnap.data();
    const zohoIntegration = orgData.integrations?.zoho;
    
    if (!zohoIntegration?.isConfigured || !zohoIntegration.accessToken) {
      return { itemsUpdated: 0, error: 'Zoho integration not configured' };
    }

    // Fetch items from Zoho and import
    const zohoItems = await getZohoItems(organizationId);
    const importedItems = await importFromZoho(zohoItems, organizationId);
    
    // Sync invoice usage data
    const usageResult = await syncInvoiceUsage(organizationId);
    
    console.log(`✅ Zoho sync completed: ${importedItems.length} items imported, ${usageResult.itemsUpdated} usage updates`);
    
    return { itemsUpdated: importedItems.length + usageResult.itemsUpdated };
  } catch (error: any) {
    console.error('❌ Zoho sync failed:', error);
    return { itemsUpdated: 0, error: error.message };
  }
};

export const sendLowStockEmailNotificationAPI = async (organizationId: string, items: InventoryItem[], recipientEmail?: string): Promise<{success: boolean, error?: string}> => {
  console.log('📧 Sending low stock email notification for organization:', organizationId);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    // Get organization
    const orgRef = orgDataService.getOrgDoc(organizationId);
    const orgSnap = await getDoc(orgRef);
    
    if (!orgSnap.exists()) {
      throw new Error('Organization not found');
    }
    
    const orgData = orgSnap.data();
    const targetEmail = recipientEmail || orgData.ownerEmail;
    
    if (!targetEmail) {
      return { success: false, error: 'No recipient email found' };
    }

    // Create notification in Firestore for server-side processing
    const notificationRef = collection(firestore, 'emailNotifications');
    await addDoc(notificationRef, {
      organizationId,
      type: 'low_stock_alert',
      recipientEmail: targetEmail,
      items: items.map(item => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        currentStock: item.stock,
        lowStockThreshold: item.threshold || 10
      })),
      createdAt: serverTimestamp(),
      status: 'pending'
    });
    
    console.log(`✅ Low stock email notification queued for ${targetEmail}`);
    return { success: true };
  } catch (error: any) {
    console.error('❌ Failed to send low stock email:', error);
    return { success: false, error: error.message };
  }
};

export const updateCategoriesAPI = async (organizationId: string, categories: string[]): Promise<void> => {
  console.log('📂 Updating organization categories:', categories.length);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const orgRef = orgDataService.getOrgDoc(organizationId);
    await updateDoc(orgRef, {
      categories: categories.filter(c => c && c.trim()).sort(),
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Categories updated successfully');
  } catch (error) {
    console.error('❌ Error updating categories:', error);
    throw error;
  }
};

export const renameCategoryInItemsAPI = async (organizationId: string, oldName: string, newName: string): Promise<void> => {
  console.log(`📝 Renaming category "${oldName}" to "${newName}" in all items`);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
    const snapshot = await getDocs(inventoryRef);
    
    const batch = writeBatch(firestore);
    let updateCount = 0;
    
    snapshot.docs.forEach(doc => {
      if (doc.id !== '_init' && doc.data().category === oldName) {
        batch.update(doc.ref, {
          category: newName,
          updatedAt: serverTimestamp()
        });
        updateCount++;
      }
    });
    
    if (updateCount > 0) {
      await batch.commit();
      console.log(`✅ Renamed category in ${updateCount} items`);
    }
    
    // Update organization categories list
    const orgRef = orgDataService.getOrgDoc(organizationId);
    const orgSnap = await getDoc(orgRef);
    
    if (orgSnap.exists()) {
      const categories = orgSnap.data().categories || [];
      const updatedCategories = categories.map((cat: string) => cat === oldName ? newName : cat);
      
      await updateDoc(orgRef, {
        categories: updatedCategories.sort(),
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.error('❌ Error renaming category:', error);
    throw error;
  }
};

export const updateZohoIntegrationAPI = async (organizationId: string, status: string, connectedAt?: string): Promise<void> => {
  console.log('🔗 Zoho integration update not yet implemented in organization-centric system');
  // TODO: Use updateOrganizationIntegrations instead
};

export const updateOrganizationCategories = async (organizationId: string, categories: string[]): Promise<void> => {
  console.log('🏷️ Updating organization categories:', categories.length);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    const orgRef = orgDataService.getOrgDoc(organizationId);
    await updateDoc(orgRef, {
      categories,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Organization categories updated successfully');
  } catch (error) {
    console.error('❌ Error updating organization categories:', error);
    throw error;
  }
};

export const deleteAllOrganizationData = async (organizationId: string): Promise<void> => {
  console.log('🗑️ Deleting all organization data for:', organizationId);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    // Delete all inventory items
    const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
    const inventorySnapshot = await getDocs(inventoryRef);
    const inventoryBatch = writeBatch(firestore);
    
    inventorySnapshot.docs.forEach((doc) => {
      if (doc.id !== '_init') { // Keep the init document
        inventoryBatch.delete(doc.ref);
      }
    });
    
    await inventoryBatch.commit();
    console.log('✅ Inventory data deleted');
    
    // Delete all activity logs
    const logsRef = orgDataService.getOrgCollection(organizationId, 'activityLogs');
    const logsSnapshot = await getDocs(logsRef);
    const logsBatch = writeBatch(firestore);
    
    logsSnapshot.docs.forEach((doc) => {
      if (doc.id !== '_init') { // Keep the init document
        logsBatch.delete(doc.ref);
      }
    });
    
    await logsBatch.commit();
    console.log('✅ Activity logs deleted');
    
    // Reset organization categories to empty
    const orgRef = orgDataService.getOrgDoc(organizationId);
    await updateDoc(orgRef, {
      categories: [],
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ All organization data deleted successfully');
  } catch (error) {
    console.error('❌ Error deleting organization data:', error);
    throw error;
  }
};

export const updateSubscriptionAPI = async (organizationId: string, plan: string, status: string): Promise<void> => {
  console.log('💳 Updating subscription (placeholder persistence):', organizationId, plan, status);
  try {
    // Placeholder: persist to organization document once implemented
    try { broadcastActivity(organizationId, { action: `Subscription changed: ${plan} -> ${status}`, type: 'SUBSCRIPTION_CHANGE', user: auth?.currentUser?.email, payload: { plan, status } }); } catch {}
  } catch (e) {
    console.error('❌ Error updating subscription:', e);
    throw e;
  }
};

export const fetchOrganizationData = async (organizationId: string): Promise<any> => {
  console.log('🏢 Using getOrganizationData instead of fetchOrganizationData');
  return await getOrganizationData(organizationId);
};

export const fetchStockMovementData = async (): Promise<any[]> => {
  console.log('📊 Stock movement analytics not yet implemented in organization-centric system');
  // TODO: Implement organization-scoped stock movement analytics
  return [];
};

export const requestDataExport = async (organizationId: string): Promise<void> => {
  console.log('📤 Exporting organization data...');
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }
  
  try {
    // Fetch all organization data
    const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
    const activityRef = orgDataService.getOrgCollection(organizationId, 'activityLogs');
    const orgRef = orgDataService.getOrgDoc(organizationId);
    
    const [inventorySnap, activitySnap, orgSnap] = await Promise.all([
      getDocs(inventoryRef),
      getDocs(activityRef),
      getDoc(orgRef)
    ]);
    
    const inventory = inventorySnap.docs
      .filter(doc => doc.id !== '_init')
      .map(doc => ({ id: doc.id, ...doc.data() }));
    
    const activityLogs = activitySnap.docs
      .filter(doc => doc.id !== '_init')
      .map(doc => ({ id: doc.id, ...doc.data() }));
    
    const organization = orgSnap.exists() ? { id: orgSnap.id, ...orgSnap.data() } : null;
    
    // Create export data
    const exportData = {
      organization,
      inventory,
      activityLogs,
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };
    
    // Convert to JSON and download
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `stockflow-export-${organizationId}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log('✅ Data export completed');
  } catch (error) {
    console.error('❌ Error exporting data:', error);
    throw error;
  }
};

export const requestDataDeletion = async (organizationId: string): Promise<void> => {
  console.log('🗑️ Account deletion request...');
  
  // For now, just show alert about contacting support
  alert(
    'Account Deletion Request\n\n' +
    'To permanently delete your account and all associated data, please contact us via WhatsApp:\n\n' +
    '+27 73 653 8207\n\n' +
    'We will process your request within 24-48 hours and send a confirmation email.'
  );
  
  console.log('✅ User notified to contact support for account deletion');
};

export const updateOrganizationAPI = async (organizationId: string, updates: any): Promise<void> => {
  console.log('🏢 Updating organization:', organizationId);
  
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }
  
  try {
    const orgRef = orgDataService.getOrgDoc(organizationId);
    await updateDoc(orgRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Organization updated successfully');
  } catch (error) {
    console.error('❌ Error updating organization:', error);
    throw error;
  }
};

// Column mapping interface for spreadsheet imports
export interface ColumnMapping {
  name: string;
  sku: string;
  costPrice: string;
  sellingPrice: string;
  quantity: string;
  category?: string;
  supplier?: string;
  description?: string;
  unit?: string;
}

// Preview spreadsheet data and suggest column mapping
export const previewSpreadsheet = async (file: File): Promise<{
  headers: string[];
  sampleData: any[];
  suggestedMapping: ColumnMapping;
}> => {
  const data = await parseSpreadsheetFile(file);
  
  if (data.length === 0) {
    throw new Error('No data found in the spreadsheet');
  }

  const headers = Object.keys(data[0]);
  const suggestedMapping = autoMatchColumns(headers);
  
  return {
    headers,
    sampleData: data.slice(0, 3), // First 3 rows for preview
    suggestedMapping
  };
};

// Import from Excel/CSV file
export const importFromSpreadsheet = async (
  file: File, 
  columnMapping: ColumnMapping | null, 
  organizationId: string
): Promise<InventoryItem[]> => {
  console.log('📥 Importing items from spreadsheet:', file.name);

  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  try {
    // Parse the file
    const data = await parseSpreadsheetFile(file);
    
    if (data.length === 0) {
      throw new Error('No data found in the spreadsheet');
    }

    // Auto-match columns if no mapping provided
    const finalMapping = columnMapping || autoMatchColumns(Object.keys(data[0]));

    // Use the shared import logic with duplicate detection
    const result = await importSpreadsheetData(data, finalMapping, organizationId);
    
    // Extract duplicate information
    const duplicatesOverwritten = (result as any)._duplicatesOverwritten || 0;
    const duplicateItems = (result as any)._duplicateItems || [];
    
    if (duplicatesOverwritten > 0) {
      console.log(`⚠️ Overwrote ${duplicatesOverwritten} duplicate items`);
      // Attach duplicate info to result for UI feedback
      (result as any)._duplicatesOverwritten = duplicatesOverwritten;
      (result as any)._duplicateItems = duplicateItems;
    }
    
    console.log(`✅ Successfully imported ${result.length} items from spreadsheet`);
    return result;
  } catch (error) {
    console.error('❌ Error importing from spreadsheet:', error);
    throw error;
  }
};

// Preview Google Sheets data
export const previewGoogleSheets = async (sheetUrl: string): Promise<{
  headers: string[];
  sampleData: any[];
  suggestedMapping: ColumnMapping;
}> => {
  const csvUrl = convertGoogleSheetsUrlToCsv(sheetUrl);
  const response = await fetch(csvUrl);
  
  if (!response.ok) {
    throw new Error('Failed to fetch Google Sheets data. Please check the URL and sharing permissions.');
  }

  const csvText = await response.text();
  const data = parseCsvData(csvText);
  
  if (data.length === 0) {
    throw new Error('No data found in the Google Sheet');
  }

  const headers = Object.keys(data[0]);
  const suggestedMapping = autoMatchColumns(headers);
  
  return {
    headers,
    sampleData: data.slice(0, 3),
    suggestedMapping
  };
};

// --- Priority Items API ---
export const getPriorityItems = async (organizationId: string): Promise<any[]> => {
  console.log('📌 Loading priority items for org:', organizationId);
  if (!firestore) throw new Error('Firestore not initialized');
  try {
    const col = orgDataService.getOrgCollection(organizationId, 'priorityItems');
    const snap = await getDocs(col);
    return snap.docs.filter(d => d.id !== '_init').map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('❌ Failed to load priority items', err);
    throw err;
  }
};

export const addPriorityItem = async (organizationId: string, itemId: string, category: string, note?: string) => {
  console.log('➕ Adding priority item', itemId, category, 'to org', organizationId);
  if (!firestore) throw new Error('Firestore not initialized');
  try {
    const col = orgDataService.getOrgCollection(organizationId, 'priorityItems');
    const docRef = await addDoc(col, {
      itemId,
      category,
      note: note || '',
      organizationId,
      addedAt: serverTimestamp()
    });
    const docSnap = await getDoc(docRef);
    return { id: docSnap.id, ...docSnap.data() };
  } catch (err) {
    console.error('❌ Failed to add priority item', err);
    throw err;
  }
};

export const removePriorityItem = async (organizationId: string, priorityId: string) => {
  console.log('➖ Removing priority item', priorityId, 'from org', organizationId);
  if (!firestore) throw new Error('Firestore not initialized');
  try {
    const col = orgDataService.getOrgCollection(organizationId, 'priorityItems');
    const ref = doc(col, priorityId);
    await deleteDoc(ref);
  } catch (err) {
    console.error('❌ Failed to remove priority item', err);
    throw err;
  }
};

export const updatePriorityItem = async (organizationId: string, priorityId: string, updates: { category?: string; note?: string }) => {
  console.log('✏️ Updating priority item', priorityId, 'in org', organizationId);
  if (!firestore) throw new Error('Firestore not initialized');
  try {
    const col = orgDataService.getOrgCollection(organizationId, 'priorityItems');
    const ref = doc(col, priorityId);
    await updateDoc(ref, updates);
  } catch (err) {
    console.error('❌ Failed to update priority item', err);
    throw err;
  }
};

// Import from Google Sheets
export const importFromGoogleSheets = async (
  sheetUrl: string, 
  columnMapping: ColumnMapping | null, 
  organizationId: string
): Promise<InventoryItem[]> => {
  console.log('📥 Importing items from Google Sheets:', sheetUrl);

  try {
    // Convert Google Sheets URL to CSV export format
    const csvUrl = convertGoogleSheetsUrlToCsv(sheetUrl);
    
    // Fetch the CSV data
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch Google Sheets data. Please check the URL and sharing permissions.');
    }

    const csvText = await response.text();
    
    // Parse CSV data
    const data = parseCsvData(csvText);
    
    if (data.length === 0) {
      throw new Error('No data found in the Google Sheet');
    }

    // Auto-match columns if no mapping provided
    const finalMapping = columnMapping || autoMatchColumns(Object.keys(data[0]));

    // Transform data using the same logic as spreadsheet import
    return await importSpreadsheetData(data, finalMapping, organizationId);
  } catch (error) {
    console.error('❌ Error importing from Google Sheets:', error);
    throw error;
  }
};

// Helper function to parse spreadsheet files (Excel/CSV)
const parseSpreadsheetFile = async (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.csv')) {
      // Handle CSV files
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result as string;
          resolve(parseCsvData(data));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read CSV file'));
      reader.readAsText(file);
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      // Handle Excel files
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = e.target?.result as ArrayBuffer;
          const parsedData = await parseExcelData(data);
          resolve(parsedData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read Excel file'));
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error('Unsupported file format. Please use CSV, XLSX, or XLS files.'));
    }
  });
};

// Helper function to parse CSV data
const parseCsvData = (csvText: string): any[] => {
  // Robust CSV parser that handles quoted fields properly
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator outside quotes
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add last field
    result.push(current.trim());
    
    return result;
  };

  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return [];

  // Parse first line to detect if it's headers or data
  const firstLine = parseCSVLine(lines[0]);
  
  // Check if first line looks like headers (text-heavy, no numbers)
  const looksLikeHeaders = firstLine.some(cell => {
    const normalized = cell.toLowerCase();
    return normalized.includes('name') || 
           normalized.includes('sku') || 
           normalized.includes('price') || 
           normalized.includes('quantity') ||
           normalized.includes('stock') ||
           normalized.includes('product') ||
           normalized.includes('item') ||
           normalized.includes('code');
  });

  let headers: string[];
  let startRow: number;
  
  if (looksLikeHeaders) {
    // Use first line as headers
    headers = firstLine;
    startRow = 1;
    console.log('✅ Detected headers in first row:', headers);
  } else {
    // No headers detected, generate column names: Col0, Col1, Col2...
    headers = firstLine.map((_, index) => `Col${index}`);
    startRow = 0;
    console.log('⚠️ No headers detected, using generated names:', headers);
  }

  const data: any[] = [];

  for (let i = startRow; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: any = {};
    
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    
    // Skip completely empty rows
    const hasData = Object.values(row).some(v => String(v).trim() !== '');
    if (hasData) {
      data.push(row);
    }
  }

  console.log(`📊 Parsed ${data.length} rows with ${headers.length} columns`);
  
  // Log sample data for debugging
  if (data.length > 0) {
    console.log('📋 Sample row (first data row):', data[0]);
    console.log('🔍 Column mapping guide:');
    headers.forEach((header, idx) => {
      const letter = String.fromCharCode(65 + idx); // A, B, C...
      const sampleValue = data[0][header];
      console.log(`  ${letter} (${idx}) = "${header}" → Sample: "${sampleValue}"`);
    });
  }
  
  return data;
};

// Helper function to parse Excel data (basic implementation)
const parseExcelData = async (arrayBuffer: ArrayBuffer): Promise<any[]> => {
  // For now, we'll provide a clear error message with instructions
  // In a production environment, you would install the 'xlsx' library: npm install xlsx
  throw new Error(
    'Excel file support requires additional setup. Please use one of these alternatives:\n\n' +
    '1. Convert your Excel file to CSV format (File → Save As → CSV)\n' +
    '2. Copy your data to Google Sheets and use the Google Sheets import option\n' +
    '3. For full Excel support, the xlsx library needs to be installed\n\n' +
    'CSV files work perfectly and are supported immediately!'
  );
};

// Helper function to automatically match columns
const autoMatchColumns = (headers: string[]): ColumnMapping => {
  const normalizeHeader = (header: string) => header.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  
  const findBestMatch = (searchTerms: string[]) => {
    for (const term of searchTerms) {
      const match = headers.find(h => normalizeHeader(h).includes(term));
      if (match) return match;
    }
    return '';
  };

  return {
    name: findBestMatch(['name', 'product', 'item', 'title', 'description']) || headers[0] || '',
    sku: findBestMatch(['sku', 'code', 'id', 'barcode', 'itemcode', 'productcode']) || headers[1] || '',
    costPrice: findBestMatch(['cost', 'costprice', 'purchase', 'buyprice', 'wholesale']),
    sellingPrice: findBestMatch(['price', 'sell', 'retail', 'sellingprice', 'saleprice']),
    quantity: findBestMatch(['quantity', 'stock', 'qty', 'amount', 'count', 'inventory']),
    category: findBestMatch(['category', 'type', 'group', 'class']),
    supplier: findBestMatch(['supplier', 'vendor', 'manufacturer', 'brand']),
    description: findBestMatch(['description', 'desc', 'notes', 'details']),
    unit: findBestMatch(['unit', 'uom', 'measure', 'packaging'])
  };
};

// Helper function to convert Google Sheets URL to CSV export URL
const convertGoogleSheetsUrlToCsv = (sheetUrl: string): string => {
  // Extract the sheet ID from various Google Sheets URL formats
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error('Invalid Google Sheets URL format');
  }
  
  const sheetId = match[1];
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
};

// Helper function to import spreadsheet data (shared logic)
const importSpreadsheetData = async (
  data: any[], 
  columnMapping: ColumnMapping, 
  organizationId: string
): Promise<InventoryItem[]> => {
  if (!firestore) {
    throw new Error('Firestore not initialized');
  }

  // Helper to resolve column identifier and access data
  const getColumnValue = (row: any, colIdentifier: string, headers: string[], shouldLog: boolean = false): any => {
    if (!colIdentifier) return undefined;
    
    const identifier = colIdentifier.trim();
    
    // Check if it's a column letter (A, B, C, etc.)
    if (/^[A-Z]+$/i.test(identifier)) {
      const columnIndex = identifier.toUpperCase().split('').reduce((acc, char, idx, arr) => {
        return acc + (char.charCodeAt(0) - 64) * Math.pow(26, arr.length - idx - 1);
      }, 0) - 1;
      
      // Access by index
      const header = headers[columnIndex];
      const value = header ? row[header] : undefined;
      if (shouldLog) {
        console.log(`  Column "${identifier}" → index ${columnIndex} → header "${header}" → value "${value}"`);
      }
      return value;
    }
    
    // Check if it's a number (0, 1, 2, etc.)
    if (/^\d+$/.test(identifier)) {
      const columnIndex = parseInt(identifier);
      const header = headers[columnIndex];
      const value = header ? row[header] : undefined;
      if (shouldLog) {
        console.log(`  Column "${identifier}" → index ${columnIndex} → header "${header}" → value "${value}"`);
      }
      return value;
    }
    
    // Otherwise, treat it as a header name
    const value = row[identifier];
    if (shouldLog) {
      console.log(`  Column "${identifier}" → direct header lookup → value "${value}"`);
    }
    return value;
  };

  // Get headers from first row
  const headers = data.length > 0 ? Object.keys(data[0]) : [];
  
  console.log('📋 Available columns:', headers);
  console.log('🗺️ User column mapping:', columnMapping);

  // Transform data based on column mapping
  const items: Omit<InventoryItem, 'id'>[] = [];
  const errors: string[] = [];
  
  // Track if we've logged column resolution (only log first row)
  let hasLoggedColumnResolution = false;
  
  for (let index = 0; index < data.length; index++) {
    const row = data[index];
    const rowNumber = index + 2; // +2 because index is 0-based and we skip header row
    
    try {
      // For first row, log detailed column resolution
      if (!hasLoggedColumnResolution) {
        console.log('🔍 Resolving columns for first data row:');
      }
      
      const name = getColumnValue(row, columnMapping.name, headers, !hasLoggedColumnResolution)?.toString().trim();
      let sku = getColumnValue(row, columnMapping.sku, headers, !hasLoggedColumnResolution)?.toString().trim();
      
      // Fix scientific notation in SKUs (e.g., 8.88032E+12 → 8880320000000)
      if (sku && /^[\d.]+E[+-]?\d+$/i.test(sku)) {
        const skuNum = parseFloat(sku);
        if (!isNaN(skuNum)) {
          // Convert to string without scientific notation
          sku = skuNum.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
          console.log(`🔢 Converted SKU from scientific notation: ${getColumnValue(row, columnMapping.sku, headers, false)} → ${sku}`);
        }
      }
      
      if (!hasLoggedColumnResolution) {
        hasLoggedColumnResolution = true;
        console.log('✅ Column resolution complete for first row');
      }
      
      // Skip empty rows
      if (!name && !sku) {
        console.log(`Skipping empty row ${rowNumber}`);
        continue;
      }
      
      if (!name || !sku) {
        errors.push(`Row ${rowNumber}: Name and SKU are required fields (Name: "${name || 'missing'}", SKU: "${sku || 'missing'}")`);
        continue;
      }

      // Parse prices with better error handling
      const costPriceStr = getColumnValue(row, columnMapping.costPrice || '', headers)?.toString().trim() || '0';
      const sellingPriceStr = getColumnValue(row, columnMapping.sellingPrice || '', headers)?.toString().trim() || '0';
      const quantityStr = getColumnValue(row, columnMapping.quantity, headers)?.toString().trim() || '0';
      
      // Clean numeric values (remove currency symbols, commas, etc.)
      const cleanNumber = (str: string) => str.replace(/[^0-9.-]/g, '');
      
      const costPrice = parseFloat(cleanNumber(costPriceStr)) || 0;
      const sellingPrice = parseFloat(cleanNumber(sellingPriceStr)) || 0;
      const quantityNum = parseFloat(cleanNumber(quantityStr));
      
      // If quantity is not a valid number, default to 0 and log warning
      let quantity = 0;
      if (isNaN(quantityNum)) {
        console.warn(`⚠️ Row ${rowNumber}: Invalid quantity "${quantityStr}", defaulting to 0`);
        quantity = 0;
      } else {
        quantity = Math.floor(quantityNum); // Convert to integer (allows negatives)
      }
      
      const item: Omit<InventoryItem, 'id'> = {
        organizationId,
        name,
        sku,
        stock: quantity,
        cost: costPrice,
        price: sellingPrice,
        category: getColumnValue(row, columnMapping.category || '', headers)?.toString().trim() || 'Uncategorized',
        supplier: getColumnValue(row, columnMapping.supplier || '', headers)?.toString().trim() || '',
        description: getColumnValue(row, columnMapping.description || '', headers)?.toString().trim() || '',
        unit: getColumnValue(row, columnMapping.unit || '', headers)?.toString().trim() || 'pcs',
        threshold: Math.max(1, Math.floor(Math.abs(quantity) * 0.1)), // Default to 10% of stock (use absolute value)
        currency: 'ZAR',
        source: 'manual' as const,
        lastModified: new Date().toISOString()
      };
      
      items.push(item);
    } catch (error) {
      errors.push(`Row ${rowNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Handle validation errors
  if (errors.length > 0) {
    const errorMessage = `Found ${errors.length} error(s) in your data:\n\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n\n...and ${errors.length - 5} more errors` : ''}`;
    throw new Error(errorMessage);
  }
  
  if (items.length === 0) {
    throw new Error('No valid items found in the spreadsheet. Please check your data and column mapping.');
  }

  // Check for duplicates by SKU and handle them
  const inventoryRef = orgDataService.getOrgCollection(organizationId, 'inventory');
  const existingSnapshot = await getDocs(inventoryRef);
  const existingItems = new Map<string, { id: string; data: any }>();
  
  existingSnapshot.docs.forEach(doc => {
    if (doc.id !== '_init') {
      const data = doc.data();
      if (data.sku) {
        existingItems.set(data.sku.toLowerCase(), { id: doc.id, data });
      }
    }
  });
  
  // Separate new items from updates
  const newItems: Omit<InventoryItem, 'id'>[] = [];
  const updateItems: { id: string; data: Omit<InventoryItem, 'id'> }[] = [];
  const duplicateWarnings: string[] = [];
  
  items.forEach((item) => {
    const existingItem = existingItems.get(item.sku.toLowerCase());
    if (existingItem) {
      updateItems.push({ id: existingItem.id, data: item });
      duplicateWarnings.push(`SKU "${item.sku}" - ${item.name}`);
    } else {
      newItems.push(item);
    }
  });
  
  // Save items to Firestore in batches (max 500 operations per batch)
  const BATCH_SIZE = 450; // Leave some room for safety
  const importedItems: InventoryItem[] = [];
  
  // Helper function to commit a batch
  const commitBatch = async (batchItems: Array<{ type: 'new' | 'update', data: any, id?: string }>) => {
    if (batchItems.length === 0) return;
    
    const batch = writeBatch(firestore);
    
    batchItems.forEach(item => {
      if (item.type === 'new') {
        const docRef = doc(inventoryRef);
        batch.set(docRef, {
          ...item.data,
          id: docRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        importedItems.push({ ...item.data, id: docRef.id } as InventoryItem);
      } else {
        const docRef = doc(inventoryRef, item.id!);
        batch.update(docRef, {
          ...item.data,
          updatedAt: serverTimestamp()
        });
        importedItems.push({ ...item.data, id: item.id } as InventoryItem);
      }
    });
    
    await batch.commit();
  };
  
  // Prepare all operations
  const allOperations: Array<{ type: 'new' | 'update', data: any, id?: string }> = [];
  
  // Add new items
  newItems.forEach((item) => {
    // Clean data to prevent undefined values
    const cleanedItem = Object.fromEntries(
      Object.entries(item).filter(([, value]) => value !== undefined && value !== null)
    ) as Omit<InventoryItem, 'id'>;

    allOperations.push({ type: 'new', data: cleanedItem });
  });
  
  // Update existing items (overwrite duplicates)
  updateItems.forEach(({ id, data }) => {
    // Clean data to prevent undefined values
    const cleanedItem = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined && value !== null)
    ) as Omit<InventoryItem, 'id'>;

    allOperations.push({ type: 'update', data: cleanedItem, id });
  });
  
  // Process in batches
  console.log(`📦 Processing ${allOperations.length} operations in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < allOperations.length; i += BATCH_SIZE) {
    const batchOperations = allOperations.slice(i, i + BATCH_SIZE);
    await commitBatch(batchOperations);
    console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allOperations.length / BATCH_SIZE)} completed (${batchOperations.length} items)`);
  }
  
  // Log duplicate handling
  if (duplicateWarnings.length > 0) {
    console.log(`⚠️ Overwritten ${duplicateWarnings.length} duplicate items:`, duplicateWarnings.slice(0, 5));
  }
  
  console.log(`✅ Import completed: ${newItems.length} new, ${updateItems.length} updated`);
  
  // Extract unique categories from imported items
  const importedCategories = new Set<string>();
  items.forEach(item => {
    if (item.category && item.category !== 'Uncategorized') {
      importedCategories.add(item.category);
    }
  });
  
  // Get existing organization categories and merge with imported ones
  if (importedCategories.size > 0) {
    try {
      const orgRef = orgDataService.getOrgDoc(organizationId);
      const orgSnap = await getDoc(orgRef);
      
      if (orgSnap.exists()) {
        const existingCategories = orgSnap.data().categories || [];
        const mergedCategories = [...new Set([...existingCategories, ...Array.from(importedCategories)])].sort();
        
        await updateDoc(orgRef, {
          categories: mergedCategories,
          updatedAt: serverTimestamp()
        });
        
        console.log(`🏷️ Updated organization categories: ${mergedCategories.length} total (added ${importedCategories.size} from import)`);
      }
    } catch (error) {
      console.error('⚠️ Failed to update categories, continuing with import:', error);
      // Don't fail the import if category update fails
    }
  }
  
  // Return items with metadata about duplicates
  const result = importedItems as any;
  result._duplicatesOverwritten = duplicateWarnings.length;
  result._duplicateItems = duplicateWarnings.slice(0, 10);
  
  return result;
};

console.log('🚀 Organization-centric API Service initialized');

// ============================
// Zoho Approval Workflow APIs
// ============================

/**
 * Append an immutable entry to the audit ledger.
 * Never call update/delete on these docs — they are the permanent financial record.
 */
const writeAuditEntry = async (
  organizationId: string,
  entry: Omit<AuditLedgerEntry, 'id' | 'timestamp'>
): Promise<void> => {
  try {
    const ledgerRef = collection(firestore, 'organizations', organizationId, 'auditLedger');
    await addDoc(ledgerRef, { ...entry, timestamp: serverTimestamp() });
  } catch (err) {
    // Audit write failures must never block the primary operation — log and continue.
    console.error('⚠️ Audit ledger write failed (non-fatal):', err);
  }
};

/**
 * Query the audit ledger for a date range (for reconciliation reports).
 */
export const getAuditLedger = async (
  organizationId: string,
  startDate: Date,
  endDate: Date
): Promise<AuditLedgerEntry[]> => {
  const ledgerRef = collection(firestore, 'organizations', organizationId, 'auditLedger');
  const q = query(
    ledgerRef,
    where('timestamp', '>=', startDate),
    where('timestamp', '<=', endDate),
    orderBy('timestamp', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })) as AuditLedgerEntry[];
};

export interface ApprovalRequest {
  id: string;
  type: 'zoho_sync';
  action: 'adjust_stock' | 'update_item' | 'create_item' | 'delete_item';
  itemId?: string;
  itemName?: string;
  itemSKU?: string;
  requestedBy: string;
  requestedByName?: string;
  requestedAt: any;
  requestedChange: {
    quantityDelta?: number;
    newQuantity?: number;
    updatedFields?: Record<string, any>;
    reason?: string;
    expectedQuantity?: number;
    unitCost?: number;
  };
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: any;
  approvalComment?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: any;
  rejectionReason?: string;
  processed: boolean;
  zohoResponse?: any;
  error?: string;
  source?: 'apk' | 'dashboard';
  stockTakeSessionId?: string;
  stockTakeSessionTimestamp?: string;
  stockTakeItemCount?: number;
}

/**
 * Get all approval requests for an organization
 */
export const getApprovals = async (organizationId: string): Promise<ApprovalRequest[]> => {
  try {
    const approvalsRef = collection(firestore, 'organizations', organizationId, 'approvals');
    const q = query(approvalsRef, orderBy('requestedAt', 'desc'));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ApprovalRequest[];
  } catch (error) {
    console.error('Error fetching approvals:', error);
    throw new Error('Failed to fetch approvals');
  }
};

/**
 * Create a new approval request
 */
/**
 * SHA-256 hash using the Web Crypto API (available in all modern browsers).
 * Used to generate idempotency keys for approval requests.
 */
const sha256 = async (input: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const createApprovalRequest = async (
  organizationId: string,
  approvalData: Omit<ApprovalRequest, 'id' | 'requestedAt' | 'status' | 'processed'>
): Promise<string> => {
  try {
    // ── Idempotency hash ───────────────────────────────────────────────────
    // Prevents duplicate Zoho transactions if the same approval is accidentally
    // submitted twice (unstable network, double-tap, retry storm).
    // Hash ingredients: session + SKU + counted qty + delta — uniquely identifies
    // one specific count result for one item in one session.
    const hashInput = [
      approvalData.stockTakeSessionId ?? organizationId,
      approvalData.itemSKU ?? approvalData.itemId ?? '',
      String(approvalData.requestedChange?.newQuantity ?? ''),
      String(approvalData.requestedChange?.quantityDelta ?? '')
    ].join('|');
    const idempotencyHash = await sha256(hashInput);

    const approvalsRef = collection(firestore, 'organizations', organizationId, 'approvals');
    const docRef = await addDoc(approvalsRef, {
      ...approvalData,
      requestedAt: serverTimestamp(),
      status: 'pending',
      processed: false,
      approvalPhase: 'operational',   // Phase 1: operational review by warehouse/admin
      idempotencyHash                 // Phase 2 guard: Zoho routes check this before syncing
    });
    
    console.log('✅ Approval request created:', docRef.id);

    // Audit ledger: immutable record of this approval being created
    await writeAuditEntry(organizationId, {
      event: 'approval_created',
      actor: approvalData.requestedBy,
      actorName: approvalData.requestedByName || 'Unknown',
      approvalId: docRef.id,
      sessionId: approvalData.stockTakeSessionId,
      itemId: approvalData.itemId,
      itemName: approvalData.itemName,
      itemSKU: approvalData.itemSKU,
      quantityDelta: approvalData.requestedChange?.quantityDelta,
      newQuantity: approvalData.requestedChange?.newQuantity,
      expectedQuantity: approvalData.requestedChange?.expectedQuantity,
      unitCost: approvalData.requestedChange?.unitCost,
      valueImpact: (approvalData.requestedChange?.quantityDelta ?? 0) * (approvalData.requestedChange?.unitCost ?? 0)
    });

    return docRef.id;
  } catch (error) {
    console.error('Error creating approval request:', error);
    throw new Error('Failed to create approval request');
  }
};

/**
 * Approve a Zoho sync request.
 *
 * @param zohoConnected - When true the Zoho Books sync is BLOCKING: local inventory
 *   is only updated after Zoho confirms the adjustment. When false (Zoho not set up)
 *   the local inventory is updated immediately (legacy behaviour).
 */
export const approveZohoSync = async (
  organizationId: string,
  approvalId: string,
  approverUid: string,
  zohoConnected: boolean = false,
  approvalComment: string = ''
): Promise<void> => {
  try {
    // Get approver name
    const userDoc = await getDoc(doc(firestore, 'organizations', organizationId, 'users', approverUid));
    const approverName = userDoc.exists() ? userDoc.data()?.name : 'Unknown Admin';
    const approverEmail = userDoc.exists() ? userDoc.data()?.email : 'admin@unknown.com';

    // Get the approval request details
    const approvalRef = doc(firestore, 'organizations', organizationId, 'approvals', approvalId);
    const approvalSnap = await getDoc(approvalRef);

    if (!approvalSnap.exists()) {
      throw new Error('Approval request not found');
    }

    const approval = approvalSnap.data();
    const { itemId, itemName, requestedBy, requestedByName, requestedChange, action } = approval;

    // Mark as approved. processed:true is only set by the backend after Zoho confirms.
    await updateDoc(approvalRef, {
      status: 'approved',
      approvedBy: approverUid,
      approvedByName: approverName,
      approvedAt: serverTimestamp(),
      ...(approvalComment.trim() ? { approvalComment: approvalComment.trim() } : {})
    });

    // Audit ledger: immutable record of operational approval
    await writeAuditEntry(organizationId, {
      event: 'approved',
      actor: approverUid,
      actorName: approverName,
      approvalId,
      sessionId: approval.stockTakeSessionId,
      itemId: approval.itemId,
      itemName: approval.itemName,
      itemSKU: approval.itemSKU,
      quantityDelta: approval.requestedChange?.quantityDelta,
      newQuantity: approval.requestedChange?.newQuantity,
      expectedQuantity: approval.requestedChange?.expectedQuantity,
      unitCost: approval.requestedChange?.unitCost,
      valueImpact: (approval.requestedChange?.quantityDelta ?? 0) * (approval.requestedChange?.unitCost ?? 0),
      approvalComment: approvalComment.trim() || undefined
    });

    console.log('✅ Approval request approved:', approvalId);

    // --- Zoho Books sync + local inventory update ---
    if (action === 'adjust_stock' && itemId && requestedChange?.quantityDelta !== undefined) {

      if (zohoConnected) {
        // BLOCKING path: send to Zoho first; local stock only updates on success.
        const processUrl = API_ENDPOINTS.zohoProcessApproval(organizationId, approvalId);
        const zohoToken = await auth.currentUser?.getIdToken();
        const processRes = await fetch(processUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(zohoToken ? { Authorization: `Bearer ${zohoToken}` } : {}),
          },
        });

        if (!processRes.ok) {
          const errData = await processRes.json().catch(() => ({}));
          const errCode = errData?.code;
          if (errCode === 'ZOHO_TOKEN_EXPIRED') {
            throw new Error('Zoho access token has expired. Reconnect Zoho in Integrations, then use "Retry Zoho Sync" on this session.');
          }
          // errData.error has the real Zoho API message; errData.message is the generic wrapper
          const zohoDetail = errData?.error || errData?.message || `HTTP ${processRes.status}`;
          throw new Error(
            `Zoho rejected the adjustment: ${zohoDetail}. ` +
            `Stock was NOT updated locally. Fix the issue and use "Send to Zoho" to retry.`
          );
        }

        // Draft submitted to Zoho successfully.
        // Local stock is NOT updated here — quantities are only ever pulled
        // from Zoho after a human approves the draft in Zoho Books.
      } else {
        // Non-blocking path: Zoho not connected, attempt sync silently but don't gate on it.
        try {
          const processUrl = API_ENDPOINTS.zohoProcessApproval(organizationId, approvalId);
          const zohoToken = await auth.currentUser?.getIdToken();
          const processRes = await fetch(processUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(zohoToken ? { Authorization: `Bearer ${zohoToken}` } : {}),
            },
          });
          if (!processRes.ok) {
            const errData = await processRes.json().catch(() => ({}));
            console.warn('⚠️ Background Zoho sync failed:', errData?.message || processRes.status);
          }
        } catch (syncError) {
          console.warn('⚠️ Background Zoho sync unreachable (non-blocking):', syncError);
        }
      }

      // When Zoho is not connected, update local inventory directly (legacy / offline path).
      if (!zohoConnected) {
        const itemRef = doc(firestore, 'organizations', organizationId, 'inventory', itemId);
        const itemSnap = await getDoc(itemRef);

        if (itemSnap.exists()) {
          const currentStock = itemSnap.data().stock || 0;
          const newStock = (requestedChange.newQuantity !== undefined)
            ? Math.max(0, requestedChange.newQuantity)
            : Math.max(0, currentStock + requestedChange.quantityDelta);

          await updateDoc(itemRef, {
            stock: newStock,
            lastUpdated: serverTimestamp(),
            lastUpdatedBy: {
              uid: approverUid,
              email: approverEmail,
              name: approverName
            }
          });

          console.log(`📦 Local inventory updated (offline): ${itemName} (${currentStock} → ${newStock})`);

          // POS write-back — non-blocking.
          const itemPosId = itemSnap.data().posId as string | undefined;
          if (itemPosId) {
            try {
              const { PosService } = await import('./posService');
              await PosService.adjustInventory(
                organizationId,
                itemPosId,
                newStock,
                `Approved stock request: ${requestedChange?.reason || 'Stock approval'}`
              );
              console.log(`✅ POS synced after approval: ${itemName} → ${newStock}`);
            } catch (posError: any) {
              console.warn('⚠️ POS sync failed after approval (non-blocking):', posError.message);
            }
          }
        }
      }
      // When Zoho IS connected, local stock is intentionally NOT updated here.
      // Quantities are pulled from Zoho after the draft is approved in Zoho Books.
    }
    
    // Create activity log for the approval
    const activityRef = collection(firestore, 'organizations', organizationId, 'activityLogs');
    await addDoc(activityRef, {
      organizationId,
      user: approverEmail,
      userName: approverName,
      action: 'Approved Stock Request',
      details: {
        approvalId,
        itemId,
        itemName,
        requestedBy: requestedByName || requestedBy,
        quantityChange: requestedChange?.quantityDelta || 0,
        newQuantity: requestedChange?.newQuantity || 0,
        reason: requestedChange?.reason || 'Stock approval',
        source: approval.source || 'unknown'
      },
      timestamp: serverTimestamp(),
      category: 'INVENTORY'
    });
    
    // Send notification to ALL users (broadcast to dashboard)
    const notificationRef = collection(firestore, 'organizations', organizationId, 'notifications');
    await addDoc(notificationRef, {
      type: 'approval_completed',
      title: '✅ Stock Request Approved',
      message: `${approverName} approved ${requestedByName || 'a user'}'s request for ${itemName} (${requestedChange?.quantityDelta > 0 ? '+' : ''}${requestedChange?.quantityDelta || 0} units)`,
      targetUserId: 'ALL',
      priority: 'normal',
      createdAt: serverTimestamp(),
      readBy: [],
      metadata: {
        approvalId,
        itemId,
        itemName,
        approvedBy: approverName,
        requestedBy: requestedByName || requestedBy,
        action: 'approved',
        source: 'dashboard'
      }
    });
    
    // Send notification to the original requester (mobile user)
    await addDoc(notificationRef, {
      type: 'your_request_approved',
      title: '🎉 Your Stock Request Was Approved!',
      message: `${approverName} approved your ${itemName} stock request (${requestedChange?.quantityDelta > 0 ? '+' : ''}${requestedChange?.quantityDelta || 0} units)`,
      targetUserId: requestedBy,
      priority: 'high',
      createdAt: serverTimestamp(),
      readBy: [],
      metadata: {
        approvalId,
        itemId,
        itemName,
        approvedBy: approverName,
        action: 'approved',
        source: 'dashboard'
      }
    });
    
    console.log('📬 Notifications sent for approval');
  } catch (error) {
    console.error('Error approving request:', error);
    throw new Error('Failed to approve request');
  }
};

/**
 * Pull current stock_on_hand from Zoho Books and write it to Firestore.
 * This is the ONLY way local stock quantities should ever be updated when
 * Zoho Books is connected.  Call this after approving a draft adjustment in Zoho.
 *
 * @param organizationId  - StockFlow org
 * @param skus            - optional SKU list; omit to sync all items
 */
export const pullQuantitiesFromZoho = async (
  organizationId: string,
  skus: string[] = []
): Promise<{ updated: number; changes: Array<{ sku: string; itemName: string; previousStock: number; newStock: number }> }> => {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(API_ENDPOINTS.zohoPullQuantities(organizationId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ skus }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err?.code === 'ZOHO_TOKEN_EXPIRED') {
      throw new Error('Zoho access token has expired. Reconnect Zoho in Integrations.');
    }
    throw new Error(err?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.data;
};

/**
 * Reject a Zoho sync request
 */
export const rejectZohoSync = async (
  organizationId: string,
  approvalId: string,
  rejecterUid: string,
  reason: string
): Promise<void> => {
  try {
    // Get rejecter name
    const userDoc = await getDoc(doc(firestore, 'organizations', organizationId, 'users', rejecterUid));
    const rejecterName = userDoc.exists() ? userDoc.data()?.name : 'Unknown Admin';
    const rejecterEmail = userDoc.exists() ? userDoc.data()?.email : 'admin@unknown.com';
    
    // Get the approval request details
    const approvalRef = doc(firestore, 'organizations', organizationId, 'approvals', approvalId);
    const approvalSnap = await getDoc(approvalRef);
    
    if (!approvalSnap.exists()) {
      throw new Error('Approval request not found');
    }
    
    const approval = approvalSnap.data();
    const { itemId, itemName, requestedBy, requestedByName, requestedChange } = approval;
    
    // Update the approval status
    await updateDoc(approvalRef, {
      status: 'rejected',
      rejectedBy: rejecterUid,
      rejectedByName: rejecterName,
      rejectedAt: serverTimestamp(),
      rejectionReason: reason,
      processed: true
    });
    
    console.log('✅ Approval request rejected:', approvalId);

    // Audit ledger: immutable record of the rejection
    await writeAuditEntry(organizationId, {
      event: 'rejected',
      actor: rejecterUid,
      actorName: rejecterName,
      approvalId,
      sessionId: approval.stockTakeSessionId,
      itemId: approval.itemId,
      itemName: approval.itemName,
      itemSKU: approval.itemSKU,
      quantityDelta: approval.requestedChange?.quantityDelta,
      expectedQuantity: approval.requestedChange?.expectedQuantity,
      unitCost: approval.requestedChange?.unitCost,
      valueImpact: (approval.requestedChange?.quantityDelta ?? 0) * (approval.requestedChange?.unitCost ?? 0),
      rejectionReason: reason
    });

    // Create activity log for the rejection
    const activityRef = collection(firestore, 'organizations', organizationId, 'activityLogs');
    await addDoc(activityRef, {
      organizationId,
      user: rejecterEmail,
      userName: rejecterName,
      action: 'Rejected Stock Request',
      details: {
        approvalId,
        itemId,
        itemName,
        requestedBy: requestedByName || requestedBy,
        quantityChange: requestedChange?.quantityDelta || 0,
        rejectionReason: reason,
        source: approval.source || 'unknown'
      },
      timestamp: serverTimestamp(),
      category: 'INVENTORY'
    });
    
    // Send notification to ALL users (broadcast to dashboard)
    const notificationRef = collection(firestore, 'organizations', organizationId, 'notifications');
    await addDoc(notificationRef, {
      type: 'approval_rejected',
      title: '❌ Stock Request Rejected',
      message: `${rejecterName} rejected ${requestedByName || 'a user'}'s request for ${itemName}. Reason: ${reason}`,
      targetUserId: 'ALL',
      priority: 'normal',
      createdAt: serverTimestamp(),
      readBy: [],
      metadata: {
        approvalId,
        itemId,
        itemName,
        rejectedBy: rejecterName,
        requestedBy: requestedByName || requestedBy,
        reason,
        action: 'rejected',
        source: 'dashboard'
      }
    });
    
    // Send notification to the original requester (mobile user)
    await addDoc(notificationRef, {
      type: 'your_request_rejected',
      title: '⚠️ Your Stock Request Was Rejected',
      message: `${rejecterName} rejected your ${itemName} stock request. Reason: ${reason}`,
      targetUserId: requestedBy,
      priority: 'high',
      createdAt: serverTimestamp(),
      readBy: [],
      metadata: {
        approvalId,
        itemId,
        itemName,
        rejectedBy: rejecterName,
        reason,
        action: 'rejected',
        source: 'dashboard'
      }
    });
    
    console.log('📬 Notifications sent for rejection');
  } catch (error) {
    console.error('Error rejecting request:', error);
    throw new Error('Failed to reject request');
  }
};
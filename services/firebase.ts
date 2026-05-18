import * as firebaseApp from 'firebase/app';
import { getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
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
  writeBatch,
  onSnapshot,
  arrayUnion
} from 'firebase/firestore';
import { getDatabase, ref, onValue, off, update, set, remove, get } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import * as firebaseAnalytics from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyAgXpzj4Q8JANNhj2Pz_cPItD-brfwfBpE",
  authDomain: "stockflow-dashboard-a1aa6.firebaseapp.com",
  databaseURL: "https://stockflow-dashboard-a1aa6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "stockflow-dashboard-a1aa6",
  storageBucket: "stockflow-dashboard-a1aa6.firebasestorage.app",
  messagingSenderId: "952334299306",
  appId: "1:952334299306:web:4a681bc6bcd99ea3c360d3",
  measurementId: "G-QZRGXKD9G3"
};

// Enhanced Firebase configuration check
export const isFirebaseConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";
export const isFirebaseInitialized = () => {
  return isFirebaseConfigured && app && auth && firestore && database;
};

let app: any;
let auth: any;
let firestore: any;
let database: any;
let storage: any;
let analytics: any;

try {
  if (isFirebaseConfigured) {
    // Check if Firebase app already exists (e.g., initialized by service worker)
    const existingApps = firebaseApp.getApps();
    if (existingApps.length > 0) {
      console.log('🔥 Firebase already initialized, reusing existing app');
      app = existingApps[0];
    } else {
      console.log('🔥 Initializing Firebase for the first time');
      app = firebaseApp.initializeApp(firebaseConfig);
    }
    
    auth = getAuth(app);
    firestore = getFirestore(app);
    database = getDatabase(app);
    storage = getStorage(app);
    console.log('🔥 Firebase services ready (Firestore + RTDB)');
  }
} catch (error) {
  console.error('❌ Firebase initialization error:', error);
  auth = null;
  firestore = null;
  database = null;
  storage = null;
  analytics = null;
}

// Note: Named exports are provided at the bottom of this file in a single block

// Organization-based Data Access Layer
export class OrganizationDataService {
  private static instance: OrganizationDataService;
  
  static getInstance(): OrganizationDataService {
    if (!OrganizationDataService.instance) {
      OrganizationDataService.instance = new OrganizationDataService();
    }
    return OrganizationDataService.instance;
  }

  // Clear all local data when switching organizations
  async clearLocalData() {
    try {
      // Clear localStorage
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('appSettings_') || key.includes('inventory_') || key.includes('logs_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // Clear sessionStorage
      sessionStorage.clear();
      
      console.log('🧹 Local data cleared successfully');
    } catch (error) {
      console.error('❌ Error clearing local data:', error);
    }
  }

  // Get organization-specific collection reference
  getOrgCollection(organizationId: string, collectionName: string) {
    if (!firestore) throw new Error('Firestore not initialized');
    return collection(firestore, 'organizations', organizationId, collectionName);
  }

  // Get organization document reference
  getOrgDoc(organizationId: string) {
    if (!firestore) throw new Error('Firestore not initialized');
    return doc(firestore, 'organizations', organizationId);
  }

  // Create organization with admin user
  async createOrganization(organizationData: any, adminUserData: any) {
    if (!firestore) throw new Error('Firestore not initialized');
    
    const batch = writeBatch(firestore);
    const orgId = organizationData.id;
    
    try {
      // Create organization document
      const orgRef = this.getOrgDoc(orgId);
      batch.set(orgRef, {
        ...organizationData,
        ownerId: adminUserData.uid, // Required by security rules for bootstrap
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        userCount: 1,
        adminUserId: adminUserData.uid
      });

      // Create admin user in organization's users subcollection
      const userRef = doc(this.getOrgCollection(orgId, 'users'), adminUserData.uid);
      batch.set(userRef, {
        ...adminUserData,
        organizationId: orgId,
        createdAt: serverTimestamp(),
        isActive: true
      });

      // Create member document for the admin user (matching new data model)
      const memberRef = doc(this.getOrgCollection(orgId, 'members'), adminUserData.uid);
      batch.set(memberRef, {
        role: 'owner', // Required field for security rules
        active: true,  // Required field for security rules
        createdAt: serverTimestamp(), // Use createdAt instead of joinedAt
        invitedBy: adminUserData.uid,
        lastActiveAt: serverTimestamp() // Add lastActiveAt field from new model
      });

      // Initialize empty collections for the organization
      const collectionsToInit = ['inventory', 'activityLogs', 'settings'];
      for (const collectionName of collectionsToInit) {
        const initRef = doc(this.getOrgCollection(orgId, collectionName), '_init');
        batch.set(initRef, {
          initialized: true,
          createdAt: serverTimestamp()
        });
      }

      // User index doc for quick lookup by uid (matching new data model)
      const userIndexRef = doc(collection(firestore, 'userIndex'), adminUserData.uid);
      batch.set(userIndexRef, {
        organizationId: orgId,
        email: adminUserData.email,
        role: 'owner' // Use consistent role value
      });

      // Email index (optional) for direct email lookup (lowercased)
      const emailKey = adminUserData.email.toLowerCase();
      const emailIndexRef = doc(collection(firestore, 'userEmailIndex'), emailKey.replace(/[^a-z0-9@._-]/g, '_'));
      batch.set(emailIndexRef, {
        userId: adminUserData.uid, // Use userId instead of uid for consistency
        email: adminUserData.email,
        organizationId: orgId
      });

      await batch.commit();
      console.log(`✅ Organization '${organizationData.name}' created successfully`);
      return { success: true, organizationId: orgId };
    } catch (error) {
      console.error('❌ Error creating organization:', error);
      throw error;
    }
  }

  // Get organization data with user validation
  async getOrganizationData(organizationId: string, userId: string) {
    if (!firestore) throw new Error('Firestore not initialized');
    
    try {
      // Verify user belongs to organization
      const userRef = doc(this.getOrgCollection(organizationId, 'users'), userId);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        throw new Error('User does not belong to this organization');
      }

      // Get organization data
      const orgRef = this.getOrgDoc(organizationId);
      const orgSnap = await getDoc(orgRef);
      
      if (!orgSnap.exists()) {
        throw new Error('Organization not found');
      }

      return {
        organization: { id: orgSnap.id, ...orgSnap.data() },
        user: { id: userSnap.id, ...userSnap.data() }
      };
    } catch (error) {
      console.error('❌ Error getting organization data:', error);
      throw error;
    }
  }

  // Get all data for an organization (inventory, users, logs, etc.)
  async getAllOrganizationData(organizationId: string) {
    if (!firestore) throw new Error('Firestore not initialized');
    
    try {
      const [inventory, users, activityLogs] = await Promise.all([
        getDocs(this.getOrgCollection(organizationId, 'inventory')),
        getDocs(this.getOrgCollection(organizationId, 'users')),
        getDocs(query(
          this.getOrgCollection(organizationId, 'activityLogs'), 
          orderBy('timestamp', 'desc'), 
          limit(100)
        ))
      ]);

      return {
        inventory: inventory.docs.filter(doc => doc.id !== '_init').map(doc => ({ id: doc.id, ...doc.data() })),
        users: users.docs.filter(doc => doc.id !== '_init').map(doc => ({ id: doc.id, ...doc.data() })),
        activityLogs: activityLogs.docs.filter(doc => doc.id !== '_init').map(doc => ({ id: doc.id, ...doc.data() }))
      };
    } catch (error) {
      console.error('❌ Error getting all organization data:', error);
      throw error;
    }
  }
}

export { 
  auth, 
  firestore, 
  firestore as db, // Alias for purchase order services
  database, 
  storage, 
  analytics,
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
  writeBatch,
  onSnapshot,
  arrayUnion,
  ref,
  onValue,
  off,
  update,
  set,
  remove,
  get
};

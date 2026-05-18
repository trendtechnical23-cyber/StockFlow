/**
 * Enhanced Firebase Data Service
 * Robust multi-tenant architecture with proper separation between Firestore and Realtime DB
 */

import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  query, 
  where, 
  orderBy, 
  limit,
  serverTimestamp,
  writeBatch,
  onSnapshot,
  DocumentData,
  QuerySnapshot,
  Unsubscribe
} from 'firebase/firestore';
import { 
  getDatabase, 
  ref, 
  set, 
  push, 
  onValue, 
  off, 
  serverTimestamp as rtServerTimestamp,
  onDisconnect
} from 'firebase/database';
import { firestore, database } from './firebase';
import { ActivityLogEntry, InventoryItem, User } from '../types';

class EnhancedDataService {
  private firestore = firestore;
  private realtimeDB = database;
  private unsubscribers: Map<string, Unsubscribe> = new Map();
  private rtListeners: Map<string, Function> = new Map();
  private deviceId: string;
  private currentOrgId: string | null = null;

  constructor() {
    this.deviceId = `dashboard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('🔥 Enhanced Data Service initialized with device ID:', this.deviceId);
  }

  // =====================================
  // ORGANIZATION MANAGEMENT
  // =====================================

  /**
   * Create a new organization with proper structure
   */
  async createOrganization(orgData: {
    id: string;
    name: string;
    domain?: string;
    adminEmail: string;
    plan?: string;
  }): Promise<void> {
    const batch = writeBatch(this.firestore);
    const { id, name, domain, adminEmail, plan = 'free' } = orgData;

    try {
      // 1. Create organization metadata
      const orgRef = doc(this.firestore, 'organizations', id);
      batch.set(orgRef, {
        metadata: {
          name,
          domain,
          plan,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          userCount: 1,
          status: 'active'
        }
      });

      // 2. Initialize required collections with proper structure
      const collections = ['users', 'inventory', 'activityLogs', 'settings', 'devices'];
      for (const collectionName of collections) {
        const initRef = doc(collection(this.firestore, 'organizations', id, collectionName), '_init');
        batch.set(initRef, {
          initialized: true,
          createdAt: serverTimestamp(),
          structure: this.getCollectionStructure(collectionName)
        });
      }

      // 3. Create email index for quick user lookup
      if (adminEmail) {
        const emailHash = btoa(adminEmail.toLowerCase()).replace(/[/+=]/g, '_');
        const emailIndexRef = doc(this.firestore, 'globalIndexes', 'userEmailIndex', emailHash);
        batch.set(emailIndexRef, {
          email: adminEmail,
          orgId: id,
          role: 'admin',
          createdAt: serverTimestamp()
        });
      }

      // 4. Initialize Realtime DB structure
      await this.initializeRealtimeStructure(id);

      await batch.commit();
      console.log('✅ Organization created successfully:', id);

    } catch (error) {
      console.error('❌ Error creating organization:', error);
      throw error;
    }
  }

  /**
   * Initialize Realtime Database structure for organization
   */
  private async initializeRealtimeStructure(orgId: string): Promise<void> {
    const rtRef = ref(this.realtimeDB, `realtime`);
    
    const initialStructure = {
      [`activities/${orgId}`]: {
        _initialized: {
          timestamp: rtServerTimestamp(),
          deviceId: this.deviceId
        }
      },
      [`presence/${orgId}`]: {
        _initialized: {
          timestamp: rtServerTimestamp()
        }
      },
      [`notifications/${orgId}`]: {
        _initialized: {
          timestamp: rtServerTimestamp()
        }
      },
      [`counters/${orgId}`]: {
        live: {
          totalItems: 0,
          lowStock: 0,
          totalValue: 0,
          activeUsers: 0,
          lastUpdate: rtServerTimestamp()
        }
      },
      [`sessions/${orgId}`]: {
        _initialized: {
          timestamp: rtServerTimestamp()
        }
      }
    };

    for (const [path, data] of Object.entries(initialStructure)) {
      await set(ref(this.realtimeDB, path), data);
    }
  }

  /**
   * Get collection structure template
   */
  private getCollectionStructure(collectionName: string): any {
    const structures = {
      users: {
        fields: ['profile', 'activity', 'security'],
        example: {
          profile: { name: 'string', email: 'string', role: 'string', permissions: 'array' },
          activity: { lastLogin: 'timestamp', deviceIds: 'array', preferences: 'object' },
          security: { mfaEnabled: 'boolean', ipWhitelist: 'array' }
        }
      },
      inventory: {
        fields: ['details', 'stock', 'pricing', 'metadata'],
        example: {
          details: { name: 'string', description: 'string', category: 'string', supplier: 'string' },
          stock: { quantity: 'number', minThreshold: 'number', maxThreshold: 'number' },
          pricing: { cost: 'number', price: 'number', margin: 'number', currency: 'string' },
          metadata: { createdBy: 'string', updatedBy: 'string', timestamps: 'object' }
        }
      },
      activityLogs: {
        fields: ['action', 'user', 'target', 'changes', 'audit'],
        example: {
          action: { type: 'string', description: 'string', category: 'string' },
          user: { id: 'string', name: 'string', role: 'string' },
          target: { type: 'string', id: 'string', name: 'string' },
          changes: { field: 'string', from: 'any', to: 'any', metadata: 'object' },
          audit: { timestamp: 'timestamp', source: 'string', deviceId: 'string', ip: 'string' }
        }
      },
      settings: {
        fields: ['billing', 'notifications', 'integrations'],
        example: {
          billing: { plan: 'string', limits: 'object', usage: 'object' },
          notifications: { email: 'boolean', push: 'boolean', slack: 'object' },
          integrations: { zoho: 'object', sheets: 'object', apis: 'object' }
        }
      },
      devices: {
        fields: ['info', 'tokens', 'status'],
        example: {
          info: { type: 'string', platform: 'string', version: 'string' },
          tokens: { fcm: 'string', apns: 'string', web: 'string' },
          status: { lastSeen: 'timestamp', active: 'boolean', permissions: 'array' }
        }
      }
    };
    return structures[collectionName] || {};
  }

  // =====================================
  // USER MANAGEMENT
  // =====================================

  /**
   * Add user to organization with proper structure
   */
  async addUserToOrganization(orgId: string, userData: {
    uid: string;
    name: string;
    email: string;
    role: string;
    permissions?: string[];
  }): Promise<void> {
    const batch = writeBatch(this.firestore);

    try {
      // 1. Create user document with structured data
      const userRef = doc(this.firestore, 'organizations', orgId, 'users', userData.uid);
      batch.set(userRef, {
        profile: {
          name: userData.name,
          email: userData.email,
          role: userData.role,
          permissions: userData.permissions || [],
          avatar: null,
          phone: null
        },
        activity: {
          lastLogin: null,
          deviceIds: [],
          preferences: {
            theme: 'light',
            notifications: true,
            language: 'en'
          },
          stats: {
            loginCount: 0,
            actionsPerformed: 0
          }
        },
        security: {
          mfaEnabled: false,
          ipWhitelist: [],
          sessionTimeout: 3600,
          lastPasswordChange: serverTimestamp()
        },
        metadata: {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: 'system',
          organizationId: orgId,
          status: 'active'
        }
      });

      // 2. Update email index
      const emailHash = btoa(userData.email.toLowerCase()).replace(/[/+=]/g, '_');
      const emailIndexRef = doc(this.firestore, 'globalIndexes', 'userEmailIndex', emailHash);
      batch.set(emailIndexRef, {
        uid: userData.uid,
        email: userData.email,
        orgId: orgId,
        role: userData.role,
        updatedAt: serverTimestamp()
      });

      // 3. Update organization user count
      const orgRef = doc(this.firestore, 'organizations', orgId);
      const orgSnap = await getDoc(orgRef);
      if (orgSnap.exists()) {
        const currentCount = orgSnap.data()?.metadata?.userCount || 0;
        batch.update(orgRef, {
          'metadata.userCount': currentCount + 1,
          'metadata.updatedAt': serverTimestamp()
        });
      }

      await batch.commit();
      console.log('✅ User added to organization successfully:', userData.email);

    } catch (error) {
      console.error('❌ Error adding user to organization:', error);
      throw error;
    }
  }

  // =====================================
  // INVENTORY MANAGEMENT
  // =====================================

  /**
   * Add inventory item with proper structure
   */
  async addInventoryItem(orgId: string, itemData: {
    name: string;
    description?: string;
    category?: string;
    supplier?: string;
    quantity: number;
    minThreshold?: number;
    maxThreshold?: number;
    cost?: number;
    price?: number;
    currency?: string;
    createdBy: string;
  }): Promise<string> {
    try {
      const itemRef = doc(collection(this.firestore, 'organizations', orgId, 'inventory'));
      const itemId = itemRef.id;

      const structuredItem = {
        details: {
          name: itemData.name,
          description: itemData.description || '',
          category: itemData.category || 'General',
          supplier: itemData.supplier || '',
          sku: itemId,
          barcode: null,
          images: []
        },
        stock: {
          quantity: itemData.quantity,
          minThreshold: itemData.minThreshold || 5,
          maxThreshold: itemData.maxThreshold || 100,
          reserved: 0,
          available: itemData.quantity,
          unit: 'pcs',
          location: 'default'
        },
        pricing: {
          cost: itemData.cost || 0,
          price: itemData.price || 0,
          margin: itemData.price && itemData.cost ? 
            ((itemData.price - itemData.cost) / itemData.cost * 100) : 0,
          currency: itemData.currency || 'USD',
          taxRate: 0,
          discountEligible: true
        },
        metadata: {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: itemData.createdBy,
          updatedBy: itemData.createdBy,
          organizationId: orgId,
          status: 'active',
          version: 1
        }
      };

      await setDoc(itemRef, structuredItem);

      // Update counters in Realtime DB
      await this.updateRealtimeCounters(orgId);

      console.log('✅ Inventory item added successfully:', itemId);
      return itemId;

    } catch (error) {
      console.error('❌ Error adding inventory item:', error);
      throw error;
    }
  }

  /**
   * Update inventory item stock
   */
  async updateItemStock(orgId: string, itemId: string, newQuantity: number, userId: string): Promise<void> {
    try {
      const itemRef = doc(this.firestore, 'organizations', orgId, 'inventory', itemId);
      const itemSnap = await getDoc(itemRef);

      if (!itemSnap.exists()) {
        throw new Error('Item not found');
      }

      const currentData = itemSnap.data();
      const oldQuantity = currentData?.stock?.quantity || 0;

      // Update Firestore
      await updateDoc(itemRef, {
        'stock.quantity': newQuantity,
        'stock.available': newQuantity - (currentData?.stock?.reserved || 0),
        'metadata.updatedAt': serverTimestamp(),
        'metadata.updatedBy': userId
      });

      // Log activity to Firestore (permanent record)
      await this.addActivityLog(orgId, {
        action: {
          type: 'stock_update',
          description: `Updated stock for ${currentData?.details?.name}`,
          category: 'inventory'
        },
        user: {
          id: userId,
          name: userId, // Will be resolved in UI
          role: 'user'
        },
        target: {
          type: 'inventory_item',
          id: itemId,
          name: currentData?.details?.name
        },
        changes: {
          field: 'quantity',
          from: oldQuantity,
          to: newQuantity,
          metadata: {
            difference: newQuantity - oldQuantity,
            unit: currentData?.stock?.unit || 'pcs'
          }
        },
        audit: {
          timestamp: serverTimestamp(),
          source: 'dashboard',
          deviceId: this.deviceId,
          ip: null
        }
      });

      // Send to Realtime DB for live updates
      await this.addRealtimeActivity(orgId, {
        userId,
        action: `Updated stock for ${currentData?.details?.name}`,
        itemId,
        itemName: currentData?.details?.name,
        quantity: newQuantity,
        source: 'dashboard',
        timestamp: new Date().toISOString(),
        deviceId: this.deviceId
      });

      // Update counters
      await this.updateRealtimeCounters(orgId);

      console.log('✅ Stock updated successfully:', itemId, oldQuantity, '→', newQuantity);

    } catch (error) {
      console.error('❌ Error updating stock:', error);
      throw error;
    }
  }

  // =====================================
  // ACTIVITY LOGGING
  // =====================================

  /**
   * Add structured activity log to Firestore (permanent record)
   */
  async addActivityLog(orgId: string, logData: {
    action: { type: string; description: string; category: string };
    user: { id: string; name: string; role: string };
    target: { type: string; id: string; name: string };
    changes: { field: string; from: any; to: any; metadata: any };
    audit: { timestamp: any; source: string; deviceId: string; ip?: string };
  }): Promise<void> {
    try {
      // Generate deterministic ID for idempotency: same action in same second = same doc
      const idempotencyKey = `${logData.user.id}_${logData.action.type}_${logData.target.id}_${logData.audit.timestamp}`;
      const docId = btoa(idempotencyKey).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
      const logRef = doc(this.firestore, 'organizations', orgId, 'activityLogs', docId);
      await setDoc(logRef, logData);
    } catch (error) {
      console.error('Error adding activity log:', error);
      throw error;
    }
  }

  /**
   * Add real-time activity to Realtime DB (live updates)
   */
  async addRealtimeActivity(orgId: string, activity: {
    userId: string;
    action: string;
    itemId?: string;
    itemName?: string;
    quantity?: number;
    source: string;
    timestamp: string;
    deviceId: string;
  }): Promise<void> {
    try {
      const activityRef = ref(this.realtimeDB, `realtime/activities/${orgId}`);
      const newActivityRef = push(activityRef);
      await set(newActivityRef, {
        ...activity,
        processed: false,
        id: newActivityRef.key
      });
    } catch (error) {
      console.error('❌ Error adding realtime activity:', error);
      throw error;
    }
  }

  /**
   * Update live counters in Realtime DB
   */
  private async updateRealtimeCounters(orgId: string): Promise<void> {
    try {
      // Get current inventory stats
      const inventoryRef = collection(this.firestore, 'organizations', orgId, 'inventory');
      const inventorySnap = await getDocs(query(inventoryRef, where('metadata.status', '==', 'active')));
      
      let totalItems = 0;
      let lowStock = 0;
      let totalValue = 0;

      inventorySnap.forEach(doc => {
        const data = doc.data();
        if (data.details?.name && data.details.name !== '_init') {
          totalItems++;
          const quantity = data.stock?.quantity || 0;
          const minThreshold = data.stock?.minThreshold || 0;
          const price = data.pricing?.price || 0;
          
          if (quantity <= minThreshold) lowStock++;
          totalValue += quantity * price;
        }
      });

      // Update counters
      const countersRef = ref(this.realtimeDB, `realtime/counters/${orgId}/live`);
      await set(countersRef, {
        totalItems,
        lowStock,
        totalValue: Math.round(totalValue * 100) / 100,
        activeUsers: 1, // Will be updated by presence system
        lastUpdate: rtServerTimestamp()
      });

    } catch (error) {
      console.error('❌ Error updating realtime counters:', error);
    }
  }

  // =====================================
  // DATA RETRIEVAL
  // =====================================

  /**
   * Get organization data with proper structure
   */
  async getOrganizationData(orgId: string): Promise<{
    organization: any;
    users: any[];
    inventory: any[];
    activityLogs: any[];
    settings: any;
  }> {
    try {
      // Get organization metadata
      const orgRef = doc(this.firestore, 'organizations', orgId);
      const orgSnap = await getDoc(orgRef);
      const organization = orgSnap.exists() ? { id: orgId, ...orgSnap.data() } : null;

      // Get users
      const usersRef = collection(this.firestore, 'organizations', orgId, 'users');
      const usersSnap = await getDocs(usersRef);
      const users = usersSnap.docs
        .filter(doc => doc.id !== '_init')
        .map(doc => ({ id: doc.id, ...doc.data() }));

      // Get inventory
      const inventoryRef = collection(this.firestore, 'organizations', orgId, 'inventory');
      const inventorySnap = await getDocs(inventoryRef);
      const inventory = inventorySnap.docs
        .filter(doc => doc.id !== '_init')
        .map(doc => ({ id: doc.id, ...doc.data() }));

      // Get activity logs (recent 100)
      const logsRef = collection(this.firestore, 'organizations', orgId, 'activityLogs');
      const logsQuery = query(logsRef, orderBy('audit.timestamp', 'desc'), limit(100));
      const logsSnap = await getDocs(logsQuery);
      const activityLogs = logsSnap.docs
        .filter(doc => doc.id !== '_init')
        .map(doc => ({ id: doc.id, ...doc.data() }));

      // Get settings
      const settingsRef = collection(this.firestore, 'organizations', orgId, 'settings');
      const settingsSnap = await getDocs(settingsRef);
      const settings = {};
      settingsSnap.forEach(doc => {
        if (doc.id !== '_init') {
          settings[doc.id] = doc.data();
        }
      });

      return {
        organization,
        users,
        inventory,
        activityLogs,
        settings
      };

    } catch (error) {
      console.error('❌ Error getting organization data:', error);
      throw error;
    }
  }

  // =====================================
  // REAL-TIME LISTENERS
  // =====================================

  /**
   * Start listening to real-time activities
   */
  startRealtimeActivityListener(orgId: string, callback: (activity: any) => void): void {
    const activityRef = ref(this.realtimeDB, `realtime/activities/${orgId}`);
    
    const listener = onValue(activityRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        Object.entries(data).forEach(([key, activity]: [string, any]) => {
          if (key !== '_initialized' && !activity.processed && activity.deviceId !== this.deviceId) {
            callback(activity);
            // Mark as processed
            set(ref(this.realtimeDB, `realtime/activities/${orgId}/${key}/processed`), true);
          }
        });
      }
    });

    this.rtListeners.set(`activity_${orgId}`, () => off(activityRef, 'value', listener));
  }

  /**
   * Stop all listeners for cleanup
   */
  cleanup(): void {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.rtListeners.forEach(cleanup => cleanup());
    this.unsubscribers.clear();
    this.rtListeners.clear();
  }
}

export const enhancedDataService = new EnhancedDataService();
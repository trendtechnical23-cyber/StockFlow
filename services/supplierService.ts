// ============================================================================
// SUPPLIER SERVICE
// Handles all Firestore operations for Suppliers
// ============================================================================

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  onSnapshot,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { Supplier, PaymentTerms } from '../types/purchaseOrders';

// ============================================================================
// CREATE SUPPLIER
// ============================================================================

export async function createSupplier(
  organizationId: string,
  supplierData: Partial<Supplier>,
  userId: string,
  userName: string
): Promise<string> {
  try {
    const now = Timestamp.now();
    
    const newSupplier: Partial<Omit<Supplier, 'id'>> = {
      name: supplierData.name || '',
      
      // Contact
      primaryContact: supplierData.primaryContact || {
        name: '',
        email: '',
        phone: ''
      },
      alternateContacts: supplierData.alternateContacts || [],
      
      // Address
      billingAddress: supplierData.billingAddress || {
        street: '',
        city: '',
        province: '',
        postalCode: '',
        country: 'South Africa'
      },
      shippingAddress: supplierData.shippingAddress || {
        street: '',
        city: '',
        province: '',
        postalCode: '',
        country: 'South Africa'
      },
      sameAsBilling: supplierData.sameAsBilling ?? true,
      
      // Financial
      defaultCurrency: supplierData.defaultCurrency || 'ZAR',
      defaultPaymentTerms: supplierData.defaultPaymentTerms || PaymentTerms.NET_30,
      currentBalance: 0,
      
      // Performance
      totalPurchases: 0,
      totalOrders: 0,
      onTimeDeliveryRate: 100,
      
      // System
      isActive: true,
      createdBy: userId,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
      
      // Zoho
      isSyncedWithZoho: !!supplierData.zohoVendorId,
      
      // Tags
      tags: supplierData.tags || []
    };
    
    // Add optional fields only if they have values
    if (supplierData.supplierId) newSupplier.supplierId = supplierData.supplierId;
    if (supplierData.supplierCode) newSupplier.supplierCode = supplierData.supplierCode;
    if (supplierData.tradingAs) newSupplier.tradingAs = supplierData.tradingAs;
    if (supplierData.taxNumber) newSupplier.taxNumber = supplierData.taxNumber;
    if (supplierData.registrationNumber) newSupplier.registrationNumber = supplierData.registrationNumber;
    if (supplierData.website) newSupplier.website = supplierData.website;
    if (supplierData.industry) newSupplier.industry = supplierData.industry;
    if (supplierData.creditLimit !== undefined) newSupplier.creditLimit = supplierData.creditLimit;
    if (supplierData.bankDetails) newSupplier.bankDetails = supplierData.bankDetails;
    if (supplierData.rating !== undefined) newSupplier.rating = supplierData.rating;
    if (supplierData.zohoVendorId) {
      newSupplier.zohoVendorId = supplierData.zohoVendorId;
      newSupplier.lastSyncAt = now;
    }
    if (supplierData.category) newSupplier.category = supplierData.category;
    
    // Remove any undefined values before sending to Firestore
    const cleanSupplier: Record<string, any> = {};
    Object.keys(newSupplier).forEach(key => {
      const value = (newSupplier as any)[key];
      if (value !== undefined) {
        cleanSupplier[key] = value;
      }
    });
    
    const supplierRef = await addDoc(
      collection(db, 'organizations', organizationId, 'suppliers'),
      cleanSupplier
    );
    
    return supplierRef.id;
  } catch (error) {
    console.error('Error creating supplier:', error);
    throw error;
  }
}

// ============================================================================
// GET SUPPLIER
// ============================================================================

export async function getSupplier(
  organizationId: string,
  supplierId: string
): Promise<Supplier | null> {
  try {
    const supplierRef = doc(db, 'organizations', organizationId, 'suppliers', supplierId);
    const supplierSnap = await getDoc(supplierRef);
    
    if (!supplierSnap.exists()) {
      return null;
    }
    
    return {
      id: supplierSnap.id,
      ...supplierSnap.data()
    } as Supplier;
  } catch (error) {
    console.error('Error getting supplier:', error);
    throw error;
  }
}

// ============================================================================
// LIST SUPPLIERS
// ============================================================================

export interface SupplierQueryOptions {
  searchTerm?: string;
  category?: string;
  tags?: string[];
  isActive?: boolean;
  limitCount?: number;
  orderByField?: 'name' | 'createdAt' | 'totalPurchases' | 'rating';
  orderDirection?: 'asc' | 'desc';
}

export async function listSuppliers(
  organizationId: string,
  options: SupplierQueryOptions = {}
): Promise<Supplier[]> {
  try {
    const constraints: QueryConstraint[] = [];
    
    // Active filter
    if (options.isActive !== undefined) {
      constraints.push(where('isActive', '==', options.isActive));
    }
    
    // Category filter
    if (options.category) {
      constraints.push(where('category', '==', options.category));
    }
    
    // Ordering
    const orderField = options.orderByField || 'name';
    const orderDir = options.orderDirection || 'asc';
    constraints.push(orderBy(orderField, orderDir));
    
    // Limit
    if (options.limitCount) {
      constraints.push(limit(options.limitCount));
    }
    
    const q = query(
      collection(db, 'organizations', organizationId, 'suppliers'),
      ...constraints
    );
    
    const querySnapshot = await getDocs(q);
    const suppliers: Supplier[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      
      // Client-side search filter
      if (options.searchTerm) {
        const term = options.searchTerm.toLowerCase();
        const matchesSearch = 
          data.name?.toLowerCase().includes(term) ||
          data.tradingAs?.toLowerCase().includes(term) ||
          data.supplierCode?.toLowerCase().includes(term) ||
          data.primaryContact?.email?.toLowerCase().includes(term);
        if (!matchesSearch) return;
      }
      
      // Client-side tags filter
      if (options.tags && options.tags.length > 0) {
        const supplierTags = data.tags || [];
        const hasMatchingTag = options.tags.some(tag => supplierTags.includes(tag));
        if (!hasMatchingTag) return;
      }
      
      suppliers.push({
        id: doc.id,
        ...data
      } as Supplier);
    });
    
    return suppliers;
  } catch (error) {
    console.error('Error listing suppliers:', error);
    throw error;
  }
}

// ============================================================================
// UPDATE SUPPLIER
// ============================================================================

export async function updateSupplier(
  organizationId: string,
  supplierId: string,
  updates: Partial<Supplier>,
  userId: string,
  userName: string
): Promise<void> {
  try {
    const supplierRef = doc(db, 'organizations', organizationId, 'suppliers', supplierId);
    
    // Remove undefined values to avoid Firestore errors
    const cleanUpdates: Record<string, any> = {};
    Object.keys(updates).forEach(key => {
      const value = (updates as any)[key];
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    });
    
    await updateDoc(supplierRef, {
      ...cleanUpdates,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating supplier:', error);
    throw error;
  }
}

// ============================================================================
// DELETE SUPPLIER (Soft Delete)
// ============================================================================

export async function deleteSupplier(
  organizationId: string,
  supplierId: string
): Promise<void> {
  try {
    const supplierRef = doc(db, 'organizations', organizationId, 'suppliers', supplierId);
    
    await updateDoc(supplierRef, {
      isActive: false,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    throw error;
  }
}

// ============================================================================
// UPDATE SUPPLIER STATISTICS
// ============================================================================

export async function updateSupplierStatistics(
  organizationId: string,
  supplierId: string,
  orderTotal: number
): Promise<void> {
  try {
    const supplierRef = doc(db, 'organizations', organizationId, 'suppliers', supplierId);
    const supplierSnap = await getDoc(supplierRef);
    
    if (supplierSnap.exists()) {
      const currentData = supplierSnap.data();
      
      await updateDoc(supplierRef, {
        totalOrders: (currentData.totalOrders || 0) + 1,
        totalPurchases: (currentData.totalPurchases || 0) + orderTotal,
        currentBalance: (currentData.currentBalance || 0) + orderTotal,
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.error('Error updating supplier statistics:', error);
    // Don't throw - statistics update shouldn't break the main operation
  }
}

// ============================================================================
// REALTIME LISTENER
// ============================================================================

export function subscribeToSuppliers(
  organizationId: string,
  callback: (suppliers: Supplier[]) => void,
  options: SupplierQueryOptions = {}
): () => void {
  try {
    const constraints: QueryConstraint[] = [
      orderBy(options.orderByField || 'name', options.orderDirection || 'asc')
    ];
    
    if (options.isActive !== undefined) {
      constraints.push(where('isActive', '==', options.isActive));
    }
    
    if (options.limitCount) {
      constraints.push(limit(options.limitCount));
    }
    
    const q = query(
      collection(db, 'organizations', organizationId, 'suppliers'),
      ...constraints
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const suppliers: Supplier[] = [];
      snapshot.forEach((doc) => {
        suppliers.push({
          id: doc.id,
          ...doc.data()
        } as Supplier);
      });
      callback(suppliers);
    });
    
    return unsubscribe;
  } catch (error) {
    console.error('Error subscribing to suppliers:', error);
    return () => {};
  }
}

// ============================================================================
// GET SUPPLIER BY ZOHO ID
// ============================================================================

export async function getSupplierByZohoId(
  organizationId: string,
  zohoVendorId: string
): Promise<Supplier | null> {
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'suppliers'),
      where('zohoVendorId', '==', zohoVendorId),
      limit(1)
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return null;
    }
    
    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data()
    } as Supplier;
  } catch (error) {
    console.error('Error getting supplier by Zoho ID:', error);
    return null;
  }
}

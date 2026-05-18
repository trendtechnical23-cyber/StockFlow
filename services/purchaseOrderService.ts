// ============================================================================
// PURCHASE ORDER SERVICE
// Handles all Firestore operations for Purchase Orders
// ============================================================================

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  writeBatch,
  increment,
  onSnapshot,
  Query,
  DocumentData,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../services/firebase';
import {
  PurchaseOrder,
  POStatus,
  POAuditLog,
  AuditEventType,
  PaymentTerms,
  ApprovalStatus,
  PaymentStatus,
  POLineItem,
  AllowedStatusTransitions
} from '../types/purchaseOrders';

// ============================================================================
// PO NUMBER GENERATION
// ============================================================================

export async function generatePONumber(organizationId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  
  const counterRef = doc(db, 'organizations', organizationId, 'counters', 'purchaseOrders');
  const counterSnap = await getDoc(counterRef);
  
  let nextNumber = 1;
  if (counterSnap.exists()) {
    nextNumber = (counterSnap.data().lastNumber || 0) + 1;
  }
  
  // Update counter (use setDoc with merge to create if doesn't exist)
  await setDoc(counterRef, {
    lastNumber: nextNumber,
    lastGeneratedAt: serverTimestamp()
  }, { merge: true });
  
  return `${prefix}${String(nextNumber).padStart(4, '0')}`;
}

// ============================================================================
// CREATE PURCHASE ORDER
// ============================================================================

export async function createPurchaseOrder(
  organizationId: string,
  poData: Partial<PurchaseOrder>,
  userId: string,
  userName: string
): Promise<string> {
  try {
    // Generate PO number if not provided (manual creation)
    const poNumber = poData.source === 'zoho' && poData.poNumber 
      ? poData.poNumber 
      : await generatePONumber(organizationId);
    
    // Calculate payment due date
    let paymentDueDate: Date | undefined;
    if (poData.paymentTerms && poData.paymentTerms !== PaymentTerms.COD) {
      const daysMap: Record<PaymentTerms, number> = {
        [PaymentTerms.NET_7]: 7,
        [PaymentTerms.NET_15]: 15,
        [PaymentTerms.NET_30]: 30,
        [PaymentTerms.NET_60]: 60,
        [PaymentTerms.NET_90]: 90,
        [PaymentTerms.CUSTOM]: poData.paymentTermsDays || 30,
        [PaymentTerms.ADVANCE]: 0,
        [PaymentTerms.COD]: 0
      };
      
      const days = daysMap[poData.paymentTerms] || 30;
      paymentDueDate = new Date();
      paymentDueDate.setDate(paymentDueDate.getDate() + days);
    }
    
    const now = Timestamp.now();
    const newPO: Partial<Omit<PurchaseOrder, 'id'>> = {
      poNumber,
      organizationId,
      source: poData.source || 'manual',
      
      // Supplier
      supplierId: poData.supplierId || '',
      supplierName: poData.supplierName || '',
      supplierEmail: poData.supplierEmail || '',
      supplierAddress: poData.supplierAddress || {
        street: '',
        city: '',
        province: '',
        postalCode: '',
        country: 'South Africa'
      },
      
      // Details
      status: poData.status || POStatus.DRAFT,
      title: poData.title || '',
      
      // Financial
      currency: poData.currency || 'ZAR',
      exchangeRate: poData.exchangeRate || 1,
      subtotal: poData.subtotal || 0,
      vatAmount: poData.vatAmount || 0,
      vatRate: poData.vatRate || 0.15,
      discountAmount: poData.discountAmount || 0,
      discountPercentage: poData.discountPercentage || 0,
      shippingCost: poData.shippingCost || 0,
      otherCharges: poData.otherCharges || 0,
      totalAmount: poData.totalAmount || 0,
      
      // Payment
      paymentTerms: poData.paymentTerms || PaymentTerms.NET_30,
      paymentStatus: PaymentStatus.UNPAID,
      amountPaid: 0,
      
      // Dates
      issueDate: poData.issueDate || now,
      
      // Line Items
      lineItems: poData.lineItems || [],
      
      // Approval
      approvalRequired: poData.approvalRequired || false,
      approvalStatus: poData.approvalRequired ? ApprovalStatus.PENDING : ApprovalStatus.NOT_REQUIRED,
      
      // Delivery
      deliveryAddress: poData.deliveryAddress || {
        street: '',
        city: '',
        province: '',
        postalCode: '',
        country: 'South Africa'
      },
      
      // System fields
      createdBy: userId,
      createdByName: userName,
      createdAt: now,
      updatedBy: userId,
      updatedByName: userName,
      updatedAt: now,
      
      // Flags
      isActive: true,
      isSynced: poData.source === 'zoho',
      
      // Arrays
      attachments: [],
      emailsSent: []
    };
    
    // Add optional fields only if they have values
    if (poData.zohoPoId) newPO.zohoPoId = poData.zohoPoId;
    if (poData.supplierPhone) newPO.supplierPhone = poData.supplierPhone;
    if (poData.supplierTaxNumber) newPO.supplierTaxNumber = poData.supplierTaxNumber;
    if (poData.description) newPO.description = poData.description;
    if (poData.referenceNumber) newPO.referenceNumber = poData.referenceNumber;
    if (poData.paymentTermsDays) newPO.paymentTermsDays = poData.paymentTermsDays;
    if (paymentDueDate) newPO.paymentDueDate = Timestamp.fromDate(paymentDueDate);
    if (poData.expectedDeliveryDate) newPO.expectedDeliveryDate = poData.expectedDeliveryDate;
    if (poData.deliveryInstructions) newPO.deliveryInstructions = poData.deliveryInstructions;
    if (poData.internalNotes) newPO.internalNotes = poData.internalNotes;
    if (poData.supplierNotes) newPO.supplierNotes = poData.supplierNotes;
    if (poData.source === 'zoho') newPO.lastSyncAt = now;
    
    // Remove any undefined values before sending to Firestore
    const cleanPO: Record<string, any> = {};
    Object.keys(newPO).forEach(key => {
      const value = (newPO as any)[key];
      if (value !== undefined) {
        cleanPO[key] = value;
      }
    });
    
    // Create PO document
    const poRef = await addDoc(
      collection(db, 'organizations', organizationId, 'purchaseOrders'),
      cleanPO
    );
    
    // Create audit log (remove undefined values)
    const auditData = {
      eventType: AuditEventType.CREATED,
      eventDescription: `Purchase Order ${poNumber} created`,
      userId: userId || 'unknown',
      userName: userName || 'Unknown User',
      userEmail: '',
      changes: []
    };
    
    await createAuditLog(organizationId, poRef.id, auditData);
    
    return poRef.id;
  } catch (error) {
    console.error('Error creating purchase order:', error);
    throw error;
  }
}

// ============================================================================
// GET PURCHASE ORDER
// ============================================================================

export async function getPurchaseOrder(
  organizationId: string,
  poId: string
): Promise<PurchaseOrder | null> {
  try {
    const poRef = doc(db, 'organizations', organizationId, 'purchaseOrders', poId);
    const poSnap = await getDoc(poRef);
    
    if (!poSnap.exists()) {
      return null;
    }
    
    return {
      id: poSnap.id,
      ...poSnap.data()
    } as PurchaseOrder;
  } catch (error) {
    console.error('Error getting purchase order:', error);
    throw error;
  }
}

// ============================================================================
// LIST PURCHASE ORDERS
// ============================================================================

export interface POQueryOptions {
  status?: POStatus[];
  supplierId?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  searchTerm?: string;
  limitCount?: number;
  orderByField?: 'createdAt' | 'totalAmount' | 'issueDate' | 'poNumber';
  orderDirection?: 'asc' | 'desc';
}

export async function listPurchaseOrders(
  organizationId: string,
  options: POQueryOptions = {}
): Promise<PurchaseOrder[]> {
  try {
    const constraints: QueryConstraint[] = [
      where('isActive', '==', true)
    ];
    
    // Add filters
    if (options.status && options.status.length > 0) {
      constraints.push(where('status', 'in', options.status));
    }
    
    if (options.supplierId) {
      constraints.push(where('supplierId', '==', options.supplierId));
    }
    
    if (options.startDate) {
      constraints.push(where('issueDate', '>=', Timestamp.fromDate(options.startDate)));
    }
    
    if (options.endDate) {
      constraints.push(where('issueDate', '<=', Timestamp.fromDate(options.endDate)));
    }
    
    // Add ordering
    const orderField = options.orderByField || 'createdAt';
    const orderDir = options.orderDirection || 'desc';
    constraints.push(orderBy(orderField, orderDir));
    
    // Add limit
    if (options.limitCount) {
      constraints.push(limit(options.limitCount));
    }
    
    const q = query(
      collection(db, 'organizations', organizationId, 'purchaseOrders'),
      ...constraints
    );
    
    const querySnapshot = await getDocs(q);
    const pos: PurchaseOrder[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      
      // Client-side filtering for amount range and search
      if (options.minAmount && data.totalAmount < options.minAmount) return;
      if (options.maxAmount && data.totalAmount > options.maxAmount) return;
      if (options.searchTerm) {
        const term = options.searchTerm.toLowerCase();
        const matchesSearch = 
          data.poNumber?.toLowerCase().includes(term) ||
          data.supplierName?.toLowerCase().includes(term) ||
          data.title?.toLowerCase().includes(term) ||
          data.referenceNumber?.toLowerCase().includes(term);
        if (!matchesSearch) return;
      }
      
      pos.push({
        id: doc.id,
        ...data
      } as PurchaseOrder);
    });
    
    return pos;
  } catch (error) {
    console.error('Error listing purchase orders:', error);
    throw error;
  }
}

// ============================================================================
// UPDATE PURCHASE ORDER
// ============================================================================

export async function updatePurchaseOrder(
  organizationId: string,
  poId: string,
  updates: Partial<PurchaseOrder>,
  userId: string,
  userName: string
): Promise<void> {
  try {
    const poRef = doc(db, 'organizations', organizationId, 'purchaseOrders', poId);
    const poSnap = await getDoc(poRef);
    
    if (!poSnap.exists()) {
      throw new Error('Purchase order not found');
    }
    
    const oldData = poSnap.data();
    
    // Track changes for audit log
    const changes: { field: string; oldValue: any; newValue: any }[] = [];
    Object.keys(updates).forEach(key => {
      if (oldData[key] !== updates[key as keyof PurchaseOrder]) {
        changes.push({
          field: key,
          oldValue: oldData[key],
          newValue: updates[key as keyof PurchaseOrder]
        });
      }
    });
    
    // Remove undefined values to avoid Firestore errors
    const cleanUpdates: Record<string, any> = {};
    Object.keys(updates).forEach(key => {
      const value = (updates as any)[key];
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    });
    
    // Update document
    await updateDoc(poRef, {
      ...cleanUpdates,
      updatedBy: userId,
      updatedByName: userName,
      updatedAt: serverTimestamp()
    });
    
    // Create audit log
    if (changes.length > 0) {
      await createAuditLog(organizationId, poId, {
        eventType: AuditEventType.EDITED,
        eventDescription: `Purchase Order updated`,
        userId,
        userName,
        userEmail: '',
        changes
      });
    }
  } catch (error) {
    console.error('Error updating purchase order:', error);
    throw error;
  }
}

// ============================================================================
// UPDATE PO STATUS
// ============================================================================

export async function updatePOStatus(
  organizationId: string,
  poId: string,
  newStatus: POStatus,
  userId: string,
  userName: string,
  reason?: string
): Promise<void> {
  try {
    const poRef = doc(db, 'organizations', organizationId, 'purchaseOrders', poId);
    const poSnap = await getDoc(poRef);
    
    if (!poSnap.exists()) {
      throw new Error('Purchase order not found');
    }
    
    const currentStatus = poSnap.data().status as POStatus;
    
    // Validate transition
    const allowedTransitions = AllowedStatusTransitions[currentStatus];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Cannot transition from ${currentStatus} to ${newStatus}`);
    }
    
    const updateData: any = {
      status: newStatus,
      updatedBy: userId,
      updatedByName: userName,
      updatedAt: serverTimestamp()
    };
    
    // Update special date fields based on status
    if (newStatus === POStatus.APPROVED) {
      updateData.approvalDate = serverTimestamp();
      updateData.approvalStatus = ApprovalStatus.APPROVED;
      updateData.approvedBy = userId;
      updateData.approvedByName = userName;
    } else if (newStatus === POStatus.REJECTED) {
      updateData.approvalStatus = ApprovalStatus.REJECTED;
      updateData.rejectedBy = userId;
      updateData.rejectedByName = userName;
      if (reason) updateData.rejectionReason = reason;
    } else if (newStatus === POStatus.SENT) {
      updateData.sentDate = serverTimestamp();
    } else if (newStatus === POStatus.RECEIVED) {
      updateData.deliveryDate = serverTimestamp();
    } else if (newStatus === POStatus.CLOSED) {
      updateData.closedDate = serverTimestamp();
    }
    
    await updateDoc(poRef, updateData);
    
    // Create audit log
    await createAuditLog(organizationId, poId, {
      eventType: AuditEventType.STATUS_CHANGED,
      eventDescription: `Status changed from ${currentStatus} to ${newStatus}`,
      userId,
      userName,
      userEmail: '',
      changes: [{
        field: 'status',
        oldValue: currentStatus,
        newValue: newStatus
      }],
      metadata: reason ? { reason } : undefined
    });
  } catch (error) {
    console.error('Error updating PO status:', error);
    throw error;
  }
}

// ============================================================================
// DELETE PURCHASE ORDER (Soft Delete)
// ============================================================================

export async function deletePurchaseOrder(
  organizationId: string,
  poId: string,
  userId: string,
  userName: string
): Promise<void> {
  try {
    const poRef = doc(db, 'organizations', organizationId, 'purchaseOrders', poId);
    
    await updateDoc(poRef, {
      isActive: false,
      updatedBy: userId,
      updatedByName: userName,
      updatedAt: serverTimestamp()
    });
    
    await createAuditLog(organizationId, poId, {
      eventType: AuditEventType.CANCELLED,
      eventDescription: 'Purchase Order deleted',
      userId,
      userName,
      userEmail: '',
      changes: []
    });
  } catch (error) {
    console.error('Error deleting purchase order:', error);
    throw error;
  }
}

// ============================================================================
// AUDIT LOG
// ============================================================================

export async function createAuditLog(
  organizationId: string,
  poId: string,
  logData: Omit<POAuditLog, 'id' | 'timestamp'>
): Promise<void> {
  try {
    const auditLogRef = collection(
      db,
      'organizations',
      organizationId,
      'purchaseOrders',
      poId,
      'auditLogs'
    );
    
    await addDoc(auditLogRef, {
      ...logData,
      timestamp: serverTimestamp()
    });
  } catch (error) {
    console.error('Error creating audit log:', error);
    // Don't throw - audit log failure shouldn't break the main operation
  }
}

export async function getPOAuditLogs(
  organizationId: string,
  poId: string
): Promise<POAuditLog[]> {
  try {
    const auditLogsRef = collection(
      db,
      'organizations',
      organizationId,
      'purchaseOrders',
      poId,
      'auditLogs'
    );
    
    const q = query(auditLogsRef, orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as POAuditLog[];
  } catch (error) {
    console.error('Error getting audit logs:', error);
    return [];
  }
}

// ============================================================================
// REALTIME LISTENER
// ============================================================================

export function subscribeToPurchaseOrders(
  organizationId: string,
  callback: (orders: PurchaseOrder[]) => void,
  options: POQueryOptions = {}
): () => void {
  try {
    const constraints: QueryConstraint[] = [
      where('isActive', '==', true),
      orderBy(options.orderByField || 'createdAt', options.orderDirection || 'desc')
    ];
    
    if (options.status && options.status.length > 0) {
      constraints.push(where('status', 'in', options.status));
    }
    
    if (options.limitCount) {
      constraints.push(limit(options.limitCount));
    }
    
    const q = query(
      collection(db, 'organizations', organizationId, 'purchaseOrders'),
      ...constraints
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const orders: PurchaseOrder[] = [];
      snapshot.forEach((doc) => {
        orders.push({
          id: doc.id,
          ...doc.data()
        } as PurchaseOrder);
      });
      callback(orders);
    });
    
    return unsubscribe;
  } catch (error) {
    console.error('Error subscribing to purchase orders:', error);
    return () => {};
  }
}

// ============================================================================
// STATISTICS
// ============================================================================

export async function getPOStatistics(organizationId: string): Promise<{
  totalPOs: number;
  totalValue: number;
  pendingApprovals: number;
  activeOrders: number;
  receivedThisMonth: number;
}> {
  try {
    const allPOs = await listPurchaseOrders(organizationId);
    
    const totalPOs = allPOs.length;
    const totalValue = allPOs.reduce((sum, po) => sum + po.totalAmount, 0);
    const pendingApprovals = allPOs.filter(po => po.status === POStatus.PENDING_APPROVAL).length;
    const activeOrders = allPOs.filter(po => 
      [POStatus.SENT, POStatus.ACKNOWLEDGED, POStatus.READY_TO_SHIP, POStatus.SHIPPED].includes(po.status)
    ).length;
    
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const receivedThisMonth = allPOs.filter(po =>
      po.status === POStatus.RECEIVED &&
      po.deliveryDate &&
      (po.deliveryDate as Timestamp).toDate() >= startOfMonth
    ).length;
    
    return {
      totalPOs,
      totalValue,
      pendingApprovals,
      activeOrders,
      receivedThisMonth
    };
  } catch (error) {
    console.error('Error getting PO statistics:', error);
    return {
      totalPOs: 0,
      totalValue: 0,
      pendingApprovals: 0,
      activeOrders: 0,
      receivedThisMonth: 0
    };
  }
}

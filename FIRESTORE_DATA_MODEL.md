# Firestore Data Model - Production Architecture

## Overview
This document defines the canonical Firestore data structure for the multi-tenant inventory management system. This structure prioritizes query efficiency, proper tenant isolation, and minimal listener usage.

## Core Principles

1. **Firestore as System of Record** - All critical data lives in Firestore
2. **RTDB for Signals Only** - Optional real-time signals, never data storage
3. **Approval-Gated Writes** - All inventory changes go through approval workflow
4. **Append-Only Audit Trail** - Immutable activity logs for compliance
5. **Organization Isolation** - Strict multi-tenant data separation

## Data Structure

### Global Collections

```typescript
// /users/{userId}
interface User {
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
}

// /devices/{deviceId}
interface Device {
  userId: string;
  fcmToken: string;
  platform: 'android' | 'web';
  appVersion: string;
  lastActiveAt: Timestamp;
}

// /userIndex/{userId}
interface UserIndex {
  organizationId: string;
  email: string;
  role: 'owner' | 'manager' | 'staff';
}

// /userEmailIndex/{emailHash}
interface UserEmailIndex {
  userId: string;
  email: string;
  organizationId: string;
}
```

### Organization Collections

```typescript
// /organizations/{orgId}
interface Organization {
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  createdAt: Timestamp;
  ownerId: string;
  settings: {
    lowStockThreshold: number;
    currency: string;
    timezone: string;
  };
}

// /organizations/{orgId}/members/{userId}
interface OrgMember {
  role: 'owner' | 'manager' | 'staff';
  active: boolean;
  createdAt: Timestamp;
  invitedBy: string;
  lastActiveAt: Timestamp;
}

// /organizations/{orgId}/inventory/{itemId}
interface InventoryItem {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  lastUsedAt: Timestamp;
  lastModifiedAt: Timestamp;
  isActive: boolean;
  priority: boolean; // daily movers
  source: 'manual' | 'zoho';
  organizationId: string;
  createdBy: string;
  metadata: {
    description?: string;
    unit?: string;
    location?: string;
  };
}

// /organizations/{orgId}/inventoryStats/{itemId}
interface InventoryStats {
  monthlyMoves: number;
  yearlyMoves: number;
  dormantScore: number; // 0-100, higher = more dormant
  lastCalculated: Timestamp;
  organizationId: string;
}

// /organizations/{orgId}/stockTakeSessions/{sessionId}
interface StockTakeSession {
  status: 'open' | 'closed' | 'approved';
  startedBy: string;
  startedAt: Timestamp;
  closedAt?: Timestamp;
  approvedBy?: string;
  approvedAt?: Timestamp;
  organizationId: string;
  description?: string;
  itemCount: number; // total items scanned
}

// /organizations/{orgId}/stockTakeEntries/{entryId}
interface StockTakeEntry {
  sessionId: string;
  itemId: string;
  countedQty: number;
  scannedBy: string;
  scannedAt: Timestamp;
  organizationId: string;
  notes?: string;
}

// /organizations/{orgId}/approvalRequests/{requestId}
interface ApprovalRequest {
  type: 'stock_adjustment' | 'zoho_write' | 'bulk_import';
  itemId: string;
  delta: number; // quantity change
  reason: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: Timestamp;
  createdAt: Timestamp;
  organizationId: string;
  metadata?: any; // type-specific data
}

// /organizations/{orgId}/activityLogs/{logId}
interface ActivityLog {
  type: 'scan' | 'approval' | 'sync' | 'login' | 'invite';
  entityType: 'inventory' | 'user' | 'session' | 'organization';
  entityId: string;
  actorId: string;
  createdAt: Timestamp;
  organizationId: string;
  details: {
    before?: any;
    after?: any;
    delta?: any;
    metadata?: any;
  };
}

// /organizations/{orgId}/notifications/{notificationId}
interface Notification {
  targetUserId: string | 'ALL'; // 'ALL' for org-wide notifications
  title: string;
  body: string;
  read: boolean;
  createdAt: Timestamp;
  organizationId: string;
  type: 'approval' | 'low_stock' | 'stock_take' | 'system';
  actionUrl?: string;
  metadata?: any;
}

// /organizations/{orgId}/settings/{key}
interface OrgSetting {
  key: string;
  value: any;
  updatedBy: string;
  updatedAt: Timestamp;
  organizationId: string;
}
```

## Query Patterns

### Inventory Queries
```typescript
// Daily movers (priority items)
inventory
  .where('organizationId', '==', orgId)
  .where('priority', '==', true)
  .where('isActive', '==', true)

// Recently used items  
inventory
  .where('organizationId', '==', orgId)
  .orderBy('lastUsedAt', 'desc')
  .limit(50)

// Category browsing
inventory
  .where('organizationId', '==', orgId)
  .where('category', '==', categoryName)
  .where('isActive', '==', true)
```

### Approval Workflow
```typescript
// Pending approvals for managers
approvalRequests
  .where('organizationId', '==', orgId)
  .where('status', '==', 'pending')
  .orderBy('createdAt', 'desc')
```

### Activity Monitoring
```typescript
// Recent activity
activityLogs
  .where('organizationId', '==', orgId)
  .orderBy('createdAt', 'desc')
  .limit(100)

// Activity by type
activityLogs
  .where('organizationId', '==', orgId)
  .where('type', '==', 'scan')
  .orderBy('createdAt', 'desc')
```

### Notification System
```typescript
// User notifications
notifications
  .where('targetUserId', 'in', [userId, 'ALL'])
  .orderBy('createdAt', 'desc')
  .limit(50)
```

## RTDB Signal Structure (Optional)

```typescript
// /signals/{userId}
interface Signal {
  lastEventAt: number; // timestamp
  type?: string; // event type hint
}
```

## Security Rules Summary

- **Organization Isolation**: Users can only access their organization's data
- **Role-Based Access**: Owner > Manager > Staff permissions
- **Approval Gates**: Only managers can modify inventory directly
- **Audit Trail**: Activity logs are append-only and immutable
- **User Privacy**: Users can only see their own notifications and profile

## Migration Checklist

- [ ] Deploy new Firestore rules
- [ ] Create composite indexes
- [ ] Migrate existing data to new structure
- [ ] Update frontend queries
- [ ] Test role-based access
- [ ] Implement approval workflow
- [ ] Set up notification system
- [ ] Configure RTDB signals (optional)
- [ ] Test offline functionality
- [ ] Load test with 1,800+ items
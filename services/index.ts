/**
 * Production-Grade Firestore Services
 * 
 * Export all services for easy import
 */

export { firestoreService, FirestoreService } from './firestoreService';
export { directNotificationService, DirectNotificationService } from './directNotificationService';
export { approvalWorkflowService, ApprovalWorkflowService } from './approvalWorkflowService';
export { archiveInventoryService, ArchiveInventoryService } from './archiveInventoryService';
export { checkUserRole, requireManager, requireStaff, requireOwner, withRoleCheck } from './roleMiddleware';

// Phase 2: Centralized services replacing direct Firebase usage
export { centralizedStockTakeService } from './centralizedStockTakeService';
export { centralizedApiService } from './centralizedApiService';
export { centralizedContextService } from './centralizedContextService';
export { centralizedErrorService } from './centralizedErrorService';

export type {
  OrgMember,
  PendingChange,
  ApprovalRequest,
  NotificationDoc
} from './firestoreService';

export type { NotificationPayload } from './directNotificationService';
export type { RoleCheckResult } from './roleMiddleware';

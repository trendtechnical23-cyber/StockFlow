/**
 * Approval Workflow Service
 * 
 * Processes pending changes when managers approve/reject them
 * Automatically updates inventory and logs changes
 */

import { firestoreService, PendingChange } from './firestoreService';
import { directNotificationService } from './directNotificationService';
import { requireManager } from './roleMiddleware';

export class ApprovalWorkflowService {
  private static instance: ApprovalWorkflowService;
  
  static getInstance(): ApprovalWorkflowService {
    if (!ApprovalWorkflowService.instance) {
      ApprovalWorkflowService.instance = new ApprovalWorkflowService();
    }
    return ApprovalWorkflowService.instance;
  }

  /**
   * Process approval of a pending change
   */
  async approveChange(
    orgId: string,
    changeId: string,
    reviewerUserId: string,
    reviewerName: string,
    notes?: string
  ): Promise<void> {
    try {
      // Check reviewer has manager role
      const roleCheck = await requireManager(reviewerUserId, orgId);
      if (!roleCheck.allowed) {
        throw new Error(roleCheck.error);
      }
      
      // Get pending change details
      const changes = await firestoreService.getPendingChanges(orgId);
      const change = changes.find(c => c.id === changeId);
      
      if (!change) {
        throw new Error('Pending change not found');
      }
      
      if (change.status !== 'pending') {
        throw new Error('Change has already been reviewed');
      }
      
      // Apply the change to inventory
      await this.applyInventoryChange(orgId, change);
      
      // Update pending change status
      await firestoreService.approvePendingChange(
        orgId,
        changeId,
        reviewerUserId,
        reviewerName,
        notes
      );
      
      // Log the approval
      await firestoreService.createActivityLog(orgId, {
        user: reviewerName,
        action: 'approved_change',
        details: `Approved ${change.changeType} request for item ${change.itemId}`,
        metadata: { changeId, originalRequester: change.requestedByName }
      });
      
      // Notify the requester
      await directNotificationService.notifyChangeReviewed(
        orgId,
        change.requestedBy,
        change.itemId,
        true,
        reviewerName,
        notes
      );
      
      console.log(`✅ Approved change ${changeId} by ${reviewerName}`);
    } catch (error) {
      console.error('❌ Error approving change:', error);
      throw error;
    }
  }

  /**
   * Process rejection of a pending change
   */
  async rejectChange(
    orgId: string,
    changeId: string,
    reviewerUserId: string,
    reviewerName: string,
    notes: string
  ): Promise<void> {
    try {
      // Check reviewer has manager role
      const roleCheck = await requireManager(reviewerUserId, orgId);
      if (!roleCheck.allowed) {
        throw new Error(roleCheck.error);
      }
      
      // Get pending change details
      const changes = await firestoreService.getPendingChanges(orgId);
      const change = changes.find(c => c.id === changeId);
      
      if (!change) {
        throw new Error('Pending change not found');
      }
      
      if (change.status !== 'pending') {
        throw new Error('Change has already been reviewed');
      }
      
      // Update pending change status
      await firestoreService.rejectPendingChange(
        orgId,
        changeId,
        reviewerUserId,
        reviewerName,
        notes
      );
      
      // Log the rejection
      await firestoreService.createActivityLog(orgId, {
        user: reviewerName,
        action: 'rejected_change',
        details: `Rejected ${change.changeType} request for item ${change.itemId}: ${notes}`,
        metadata: { changeId, originalRequester: change.requestedByName }
      });
      
      // Notify the requester
      await directNotificationService.notifyChangeReviewed(
        orgId,
        change.requestedBy,
        change.itemId,
        false,
        reviewerName,
        notes
      );
      
      console.log(`✅ Rejected change ${changeId} by ${reviewerName}`);
    } catch (error) {
      console.error('❌ Error rejecting change:', error);
      throw error;
    }
  }

  /**
   * Apply inventory change after approval
   */
  private async applyInventoryChange(orgId: string, change: PendingChange): Promise<void> {
    try {
      switch (change.changeType) {
        case 'add':
          // Add quantity to existing item
          const item = await firestoreService.getInventoryItem(orgId, change.itemId);
          if (item) {
            await firestoreService.updateInventoryItem(orgId, change.itemId, {
              stock: item.stock + (change.quantity || 0)
            });
          }
          break;
          
        case 'remove':
          // Remove quantity from existing item
          const itemToRemove = await firestoreService.getInventoryItem(orgId, change.itemId);
          if (itemToRemove) {
            const newStock = Math.max(0, itemToRemove.stock - (change.quantity || 0));
            await firestoreService.updateInventoryItem(orgId, change.itemId, {
              stock: newStock
            });
          }
          break;
          
        case 'update':
          // Update item fields
          if (change.updates) {
            await firestoreService.updateInventoryItem(orgId, change.itemId, change.updates);
          }
          break;
          
        case 'create':
          // Create new item
          if (change.updates) {
            await firestoreService.createInventoryItem(orgId, change.updates);
          }
          break;
          
        case 'delete':
          // Delete item
          await firestoreService.deleteInventoryItem(orgId, change.itemId);
          break;
          
        default:
          throw new Error(`Unknown change type: ${change.changeType}`);
      }
      
      // Notify all staff about the inventory change
      await directNotificationService.notifyInventoryChange(
        orgId,
        change.itemId,
        change.changeType,
        change.requestedByName
      );
    } catch (error) {
      console.error('❌ Error applying inventory change:', error);
      throw error;
    }
  }

  /**
   * Staff submits a pending change request
   */
  async submitChangeRequest(
    orgId: string,
    userId: string,
    userName: string,
    changeRequest: {
      itemId: string;
      changeType: 'add' | 'remove' | 'update' | 'create' | 'delete';
      quantity?: number;
      updates?: any;
      reason: string;
    }
  ): Promise<string> {
    try {
      // Create pending change
      const changeId = await firestoreService.createPendingChange(orgId, {
        itemId: changeRequest.itemId,
        changeType: changeRequest.changeType,
        quantity: changeRequest.quantity,
        updates: changeRequest.updates,
        reason: changeRequest.reason,
        requestedBy: userId,
        requestedByName: userName,
        requestedAt: new Date(),
        status: 'pending'
      });
      
      // Log the request
      await firestoreService.createActivityLog(orgId, {
        user: userName,
        action: 'submitted_change_request',
        details: `Requested ${changeRequest.changeType} for item ${changeRequest.itemId}`,
        metadata: { changeId, reason: changeRequest.reason }
      });
      
      // Notify managers
      await directNotificationService.notifyPendingChange(
        orgId,
        changeRequest.itemId,
        changeRequest.changeType,
        userName
      );
      
      console.log(`✅ Change request ${changeId} submitted by ${userName}`);
      return changeId;
    } catch (error) {
      console.error('❌ Error submitting change request:', error);
      throw error;
    }
  }
}

export const approvalWorkflowService = ApprovalWorkflowService.getInstance();

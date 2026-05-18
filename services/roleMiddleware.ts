/**
 * Role-Based Access Control Middleware
 * 
 * Checks user roles before allowing protected backend actions
 */

import { firestoreService } from './firestoreService';
import { UserRole } from '../types';

export interface RoleCheckResult {
  allowed: boolean;
  role?: UserRole;
  error?: string;
}

/**
 * Check if user has required role for an action
 */
export async function checkUserRole(
  userId: string,
  orgId: string,
  requiredRoles: UserRole[]
): Promise<RoleCheckResult> {
  try {
    const member = await firestoreService.getMember(orgId, userId);
    
    if (!member) {
      return {
        allowed: false,
        error: 'User is not a member of this organization'
      };
    }
    
    if (!requiredRoles.includes(member.role)) {
      return {
        allowed: false,
        role: member.role,
        error: `Insufficient permissions. Required: ${requiredRoles.join(' or ')}. User has: ${member.role}`
      };
    }
    
    return {
      allowed: true,
      role: member.role
    };
  } catch (error) {
    console.error('Error checking user role:', error);
    return {
      allowed: false,
      error: 'Failed to verify user permissions'
    };
  }
}

/**
 * Check if user is a manager or owner
 */
export async function requireManager(userId: string, orgId: string): Promise<RoleCheckResult> {
  return checkUserRole(userId, orgId, ['owner', 'manager']);
}

/**
 * Check if user is staff, manager, or owner
 */
export async function requireStaff(userId: string, orgId: string): Promise<RoleCheckResult> {
  return checkUserRole(userId, orgId, ['owner', 'manager', 'staff']);
}

/**
 * Check if user is owner
 */
export async function requireOwner(userId: string, orgId: string): Promise<RoleCheckResult> {
  return checkUserRole(userId, orgId, ['owner']);
}

/**
 * Higher-order function to wrap actions with role checks
 */
export function withRoleCheck(
  requiredRoles: UserRole[],
  action: (userId: string, orgId: string, ...args: any[]) => Promise<any>
) {
  return async (userId: string, orgId: string, ...args: any[]) => {
    const roleCheck = await checkUserRole(userId, orgId, requiredRoles);
    
    if (!roleCheck.allowed) {
      throw new Error(roleCheck.error || 'Permission denied');
    }
    
    return action(userId, orgId, ...args);
  };
}

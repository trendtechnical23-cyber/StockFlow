// Quick console helpers for user management
// Use these functions in the browser console for testing

import { addExistingUserToOrganization } from '../services/apiService';

// Make functions available globally for console use
declare global {
  interface Window {
    inviteUser: (email: string, organizationId?: string, role?: 'Admin' | 'User') => Promise<void>;
    showInviteHelper: () => void;
  }
}

// Helper function to invite a user (call from console)
window.inviteUser = async (email: string, organizationId?: string, role: 'Admin' | 'User' = 'User') => {
  try {
    // Get current user's organization ID if not provided
    const orgId = organizationId || localStorage.getItem('organizationId');
    if (!orgId) {
      console.error('❌ No organization ID found. Please provide it as the second parameter.');
      return;
    }

    console.log(`📨 Inviting ${email} to organization ${orgId} as ${role}...`);
    
    await addExistingUserToOrganization(email, orgId, role as any);
    
    console.log(`✅ Successfully invited ${email}!`);
    console.log(`📧 Tell them to:`);
    console.log(`   1. Go to your dashboard URL`);
    console.log(`   2. Click "Sign Up"`);
    console.log(`   3. Use email: ${email}`);
    console.log(`   4. Create a password`);
    console.log(`   5. They'll automatically join your organization`);
  } catch (error: any) {
    console.error('❌ Failed to invite user:', error.message);
  }
};

// Helper function to show usage instructions
window.showInviteHelper = () => {
  console.log(`
🚀 QUICK USER INVITE HELPER

Usage in console:
  inviteUser("user@example.com")              // Invite as User
  inviteUser("admin@example.com", null, "Admin")  // Invite as Admin
  
Examples:
  inviteUser("john@example.com")
  inviteUser("manager@example.com", null, "Admin")
  
The invited person just needs to:
1. Go to your dashboard
2. Click "Sign Up" 
3. Use the same email you invited
4. Create a password
5. They'll automatically join your organization!

Tips:
- Make sure you're logged in first
- Users must sign up with the EXACT email you invite
- They can use any password they want
  `);
};

// Show helper on load
console.log('🎯 User invite helper loaded! Type showInviteHelper() for instructions.');
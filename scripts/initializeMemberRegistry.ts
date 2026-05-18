/**
 * 🔧 Member Registry Initialization Script
 * 
 * PURPOSE:
 * After deploying new Firebase rules, you need to initialize the member registry
 * in Realtime Database. This script does that automatically after first signup.
 * 
 * WHEN TO USE:
 * 1. Fresh Firebase deployment (all data deleted)
 * 2. After first user signs up
 * 3. User can login but gets "Organization setup required"
 * 
 * HOW TO RUN:
 * 1. Open browser console (F12)
 * 2. Copy-paste this entire file
 * 3. Press Enter
 * 4. Refresh the page
 * 
 * WHAT IT DOES:
 * - Reads current user from Firebase Auth
 * - Reads organization from Firestore
 * - Adds member to Realtime Database at organizations/{orgId}/members/{uid}
 * - This allows Realtime DB permissions to work
 */

import { ref, set, get } from 'firebase/database';
import { database, auth, firestore } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

async function initializeMemberRegistry() {
  console.log('🔧 Starting member registry initialization...');
  
  // Step 1: Get current user
  const user = auth.currentUser;
  if (!user) {
    console.error('❌ No authenticated user. Please login first.');
    return;
  }
  
  console.log('✅ Current user:', user.email, user.uid);
  
  // Step 2: Get user's organization from Firestore
  try {
    const userDoc = await getDoc(doc(firestore, 'users', user.uid));
    if (!userDoc.exists()) {
      console.error('❌ User document not found in Firestore');
      return;
    }
    
    const userData = userDoc.data();
    const orgId = userData.organizationId;
    
    if (!orgId) {
      console.error('❌ User has no organization ID');
      return;
    }
    
    console.log('✅ Organization ID:', orgId);
    
    // Step 3: Get organization details
    const orgDoc = await getDoc(doc(firestore, 'organizations', orgId));
    if (!orgDoc.exists()) {
      console.error('❌ Organization document not found');
      return;
    }
    
    console.log('✅ Organization:', orgDoc.data().name);
    
    // Step 4: Add member to Realtime Database
    const memberRef = ref(database, `organizations/${orgId}/members/${user.uid}`);
    await set(memberRef, {
      userId: user.uid,
      email: user.email,
      name: userData.name || user.displayName || user.email?.split('@')[0] || 'User',
      role: userData.role || 'owner', // First user is always owner
      joinedAt: Date.now(),
      lastSeen: Date.now()
    });
    
    console.log('✅ Member added to Realtime Database');
    console.log('📍 Path: organizations/' + orgId + '/members/' + user.uid);
    
    // Step 5: Verify the write
    const snapshot = await get(memberRef);
    if (snapshot.exists()) {
      console.log('✅ Verification successful:', snapshot.val());
      console.log('');
      console.log('🎉 Member registry initialized!');
      console.log('👉 You can now refresh the page and access real-time features');
    } else {
      console.error('❌ Verification failed - member not found in database');
    }
    
  } catch (error) {
    console.error('❌ Error initializing member registry:', error);
    console.error('Full error:', error.message);
  }
}

// Auto-run on page load if needed
if (typeof window !== 'undefined') {
  console.log('💡 To initialize member registry, run: initializeMemberRegistry()');
  console.log('Or paste this file in browser console and press Enter');
  
  // Make function available globally
  (window as any).initializeMemberRegistry = initializeMemberRegistry;
}

export default initializeMemberRegistry;

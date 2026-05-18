/**
 * Firebase Data Structure Setup Script
 * Run this to initialize the robust multi-tenant data architecture
 */

import { enhancedAPI } from '../services/enhancedAPIService';

class DataStructureSetup {
  /**
   * Initialize organization with proper structure
   */
  async setupNewOrganization(orgData: {
    name: string;
    domain?: string;
  }): Promise<string> {
    try {
      // Generate organization ID
      const orgId = `org_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log('🏗️ Setting up organization:', orgData.name);
      
      // Create organization with enhanced structure
      await enhancedAPI.createOrganization({
        id: orgId,
        name: orgData.name,
        domain: orgData.domain,
        adminEmail: '', // Will be set when first user registers
        plan: 'free'
      });

      console.log('✅ Organization setup complete!');
      console.log('🆔 Organization ID:', orgId);
      
      return orgId;

    } catch (error) {
      console.error('❌ Error setting up organization:', error);
      throw error;
    }
  }



  /**
   * Test data operations
   */
  async testDataOperations(orgId: string): Promise<void> {
    console.log('🧪 Testing data operations...');
    
    try {
      // Test data retrieval
      const data = await enhancedAPI.getOrganizationData(orgId);
      console.log('📊 Retrieved data:', {
        inventory: data.inventory.length,
        users: data.users.length,
        activityLogs: data.activityLogs.length
      });

      // Test activity logging
      console.log('📝 Testing activity logging...');
      await enhancedAPI.addLogAPI({
        user: 'system@test.com',
        action: 'System initialization test',
        details: { type: 'system_test', source: 'setup_script' }
      }, orgId);

      console.log('✅ All tests passed!');

    } catch (error) {
      console.error('❌ Test failed:', error);
      throw error;
    }
  }

  /**
   * Validate Firebase structure
   */
  async validateStructure(orgId: string): Promise<boolean> {
    try {
      console.log('🔍 Validating Firebase structure...');
      
      const data = await enhancedAPI.getOrganizationData(orgId);
      
      // Check required collections exist
      const hasInventory = data.inventory && Array.isArray(data.inventory);
      const hasUsers = data.users && Array.isArray(data.users);
      const hasActivityLogs = data.activityLogs && Array.isArray(data.activityLogs);
      
      // Check data structure (empty inventory is valid for fresh org)
      const inventoryStructureValid = data.inventory.length === 0 || data.inventory.every(item => 
        item.id && item.name && typeof item.quantity === 'number'
      );
      
      const userStructureValid = data.users.every(user => 
        user.id && user.email && user.role
      );

      const validation = {
        hasInventory,
        hasUsers,
        hasActivityLogs,
        inventoryStructureValid,
        userStructureValid
      };

      console.log('📋 Validation results:', validation);
      
      const isValid = Object.values(validation).every(v => v === true);
      
      if (isValid) {
        console.log('✅ Structure validation passed!');
      } else {
        console.log('❌ Structure validation failed!');
      }
      
      return isValid;

    } catch (error) {
      console.error('❌ Validation error:', error);
      return false;
    }
  }
}

// Export setup utilities
export const dataSetup = new DataStructureSetup();

// Console helper for manual setup
if (typeof window !== 'undefined') {
  (window as any).setupOrganization = async (name: string, domain?: string) => {
    try {
      const orgId = await dataSetup.setupNewOrganization({ name, domain });
      await dataSetup.testDataOperations(orgId);
      const isValid = await dataSetup.validateStructure(orgId);
      
      if (isValid) {
        console.log('🎉 Organization setup complete and validated!');
        console.log('🔗 Use this organization ID in your app:', orgId);
      }
      
      return orgId;
    } catch (error) {
      console.error('Setup failed:', error);
    }
  };
  
  console.log('🛠️ Firebase setup tools loaded!');
  console.log('📝 Usage: setupOrganization("Company Name", "company.com")');
}
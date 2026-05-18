/**
 * Archive Inventory Service
 * 
 * Automatically moves items to archive after 6 months of inactivity
 * Keeps active inventory fast and reduces quota usage
 */

import { firestoreService } from './firestoreService';
import { InventoryItem } from '../types';

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months in milliseconds

export class ArchiveInventoryService {
  private static instance: ArchiveInventoryService;
  
  static getInstance(): ArchiveInventoryService {
    if (!ArchiveInventoryService.instance) {
      ArchiveInventoryService.instance = new ArchiveInventoryService();
    }
    return ArchiveInventoryService.instance;
  }

  /**
   * Find items that should be archived (6+ months inactive)
   */
  async findItemsToArchive(orgId: string): Promise<InventoryItem[]> {
    try {
      const allItems = await firestoreService.getActiveInventory(orgId, 1000);
      const sixMonthsAgo = Date.now() - SIX_MONTHS_MS;
      
      const itemsToArchive = allItems.filter(item => {
        const lastUsed = item.lastUsed;
        // Skip if no lastUsed date
        if (!lastUsed) return false;
        
        // Convert Firestore timestamp to milliseconds
        const lastUsedMs = typeof lastUsed === 'object' && 'toMillis' in lastUsed
          ? lastUsed.toMillis()
          : new Date(lastUsed).getTime();
        
        return lastUsedMs < sixMonthsAgo;
      });
      
      console.log(`📦 Found ${itemsToArchive.length} items eligible for archiving`);
      return itemsToArchive;
    } catch (error) {
      console.error('❌ Error finding items to archive:', error);
      return [];
    }
  }

  /**
   * Archive a single item
   */
  async archiveItem(orgId: string, itemId: string): Promise<void> {
    try {
      await firestoreService.archiveInventoryItem(orgId, itemId);
      console.log(`✅ Archived item ${itemId}`);
    } catch (error) {
      console.error(`❌ Error archiving item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Archive multiple items
   */
  async archiveItems(orgId: string, itemIds: string[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;
    
    for (const itemId of itemIds) {
      try {
        await this.archiveItem(orgId, itemId);
        success++;
      } catch (error) {
        failed++;
      }
    }
    
    console.log(`📊 Archive summary: ${success} succeeded, ${failed} failed`);
    return { success, failed };
  }

  /**
   * Auto-archive all eligible items
   */
  async autoArchive(orgId: string): Promise<{ archived: number; errors: number }> {
    try {
      const itemsToArchive = await this.findItemsToArchive(orgId);
      
      if (itemsToArchive.length === 0) {
        console.log('✅ No items need archiving');
        return { archived: 0, errors: 0 };
      }
      
      const itemIds = itemsToArchive.map(item => item.id!);
      const result = await this.archiveItems(orgId, itemIds);
      
      return {
        archived: result.success,
        errors: result.failed
      };
    } catch (error) {
      console.error('❌ Error in auto-archive:', error);
      return { archived: 0, errors: 1 };
    }
  }

  /**
   * Restore an item from archive
   */
  async restoreItem(orgId: string, itemId: string): Promise<void> {
    try {
      await firestoreService.restoreFromArchive(orgId, itemId);
      console.log(`✅ Restored item ${itemId} from archive`);
    } catch (error) {
      console.error(`❌ Error restoring item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Get archived inventory with pagination
   */
  async getArchivedInventory(orgId: string, limit: number = 100): Promise<InventoryItem[]> {
    return firestoreService.getArchivedInventory(orgId, limit);
  }

  /**
   * Check if item should be archived
   */
  shouldArchive(item: InventoryItem): boolean {
    const lastUsed = item.lastUsed;
    if (!lastUsed) return false;
    
    const lastUsedMs = typeof lastUsed === 'object' && 'toMillis' in lastUsed
      ? lastUsed.toMillis()
      : new Date(lastUsed).getTime();
    
    const sixMonthsAgo = Date.now() - SIX_MONTHS_MS;
    return lastUsedMs < sixMonthsAgo;
  }

  /**
   * Get archive statistics
   */
  async getArchiveStats(orgId: string): Promise<{
    activeCount: number;
    archivedCount: number;
    eligibleForArchive: number;
  }> {
    try {
      const [activeItems, archivedItems, eligibleItems] = await Promise.all([
        firestoreService.getActiveInventory(orgId, 10000),
        firestoreService.getArchivedInventory(orgId, 10000),
        this.findItemsToArchive(orgId)
      ]);
      
      return {
        activeCount: activeItems.length,
        archivedCount: archivedItems.length,
        eligibleForArchive: eligibleItems.length
      };
    } catch (error) {
      console.error('❌ Error getting archive stats:', error);
      return {
        activeCount: 0,
        archivedCount: 0,
        eligibleForArchive: 0
      };
    }
  }
}

export const archiveInventoryService = ArchiveInventoryService.getInstance();

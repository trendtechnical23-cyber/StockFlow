
// Local Algorithm for Restock Suggestions
import type { InventoryItem, RestockSuggestion } from '../types';

// Smart restock algorithm based on inventory patterns
const generateLocalSuggestions = (lowStockItems: InventoryItem[]): RestockSuggestion[] => {
  console.log('🤖 Analyzing', lowStockItems.length, 'low stock items');
  
  return lowStockItems.map(item => {
    const stockDeficit = item.threshold - item.stock;
    const stockRatio = item.stock / item.threshold;
    
    // Determine priority based on how critical the shortage is
    let priority: 'High' | 'Medium' | 'Low';
    let multiplier: number;
    
    if (item.stock <= 0) {
      // Critical - completely out of stock
      priority = 'High';
      multiplier = 3;
    } else if (stockRatio <= 0.25) {
      // Very low - less than 25% of threshold
      priority = 'High';
      multiplier = 2.5;
    } else if (stockRatio <= 0.5) {
      // Low - less than 50% of threshold
      priority = 'Medium';
      multiplier = 2;
    } else {
      // Approaching threshold - 50-100% of threshold
      priority = 'Low';
      multiplier = 1.5;
    }
    
    // Calculate suggested quantity
    // Base it on threshold + buffer, considering usage patterns
    let suggestedQuantity = Math.max(
      item.threshold * multiplier,
      stockDeficit + item.threshold
    );
    
    // Round to reasonable quantities
    if (suggestedQuantity <= 10) {
      suggestedQuantity = Math.ceil(suggestedQuantity);
    } else if (suggestedQuantity <= 50) {
      suggestedQuantity = Math.ceil(suggestedQuantity / 5) * 5;
    } else {
      suggestedQuantity = Math.ceil(suggestedQuantity / 10) * 10;
    }
    
    return {
      sku: item.sku,
      name: item.name,
      suggestedQuantity,
      priority
    };
  }).sort((a, b) => {
    // Sort by priority (High -> Medium -> Low)
    const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
};

export const getRestockSuggestions = async (inventory: InventoryItem[]): Promise<RestockSuggestion[]> => {
  console.log('🤖 Generating restock suggestions for', inventory.length, 'items');
  
  const lowStockItems = inventory.filter(item => item.stock <= item.threshold);
  console.log('🤖 Found', lowStockItems.length, 'low stock items');

  if (lowStockItems.length === 0) {
    console.log('✅ No low stock items found');
    return [];
  }

  // Use local algorithm for all suggestions
  return generateLocalSuggestions(lowStockItems);
};
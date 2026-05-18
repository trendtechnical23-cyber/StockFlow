/**
 * Utility functions for safe inventory data handling
 */

/**
 * Ensures stock value is never negative
 */
export const safeStock = (stock: number | undefined | null): number => {
  if (typeof stock !== 'number' || isNaN(stock)) {
    return 0;
  }
  return Math.max(0, Math.round(stock));
};

/**
 * Ensures threshold value is never negative or zero
 */
export const safeThreshold = (threshold: number | undefined | null): number => {
  if (typeof threshold !== 'number' || isNaN(threshold)) {
    return 10; // Default threshold
  }
  return Math.max(1, Math.round(threshold));
};

/**
 * Safely calculates if an item is low stock
 */
export const isLowStock = (stock: number | undefined | null, threshold: number | undefined | null): boolean => {
  return safeStock(stock) <= safeThreshold(threshold);
};

/**
 * Safely calculates if an item is out of stock
 */
export const isOutOfStock = (stock: number | undefined | null): boolean => {
  return safeStock(stock) === 0;
};

/**
 * Formats stock value for display (never shows negative)
 */
export const formatStock = (stock: number | undefined | null): string => {
  return safeStock(stock).toString();
};

/**
 * Calculates total stock from inventory array safely
 */
export const calculateTotalStock = (inventory: Array<{ stock?: number }>): number => {
  return inventory.reduce((sum, item) => sum + safeStock(item.stock), 0);
};

/**
 * Calculates total inventory value from an array of inventory items.
 * Supports different data shapes: flat (item.cost, item.stock) and nested (item.pricing.price, item.stock.quantity).
 */
export const calculateTotalValue = (inventory: Array<any>): number => {
  const total = inventory.reduce((sum, item) => {
    try {
      // Try flat shape first
      const stockFlat = typeof item.stock === 'number' ? item.stock : (item.stock?.quantity ?? item.quantity ?? 0);
      const costFlat = typeof item.cost === 'number' ? item.cost : (item.pricing?.price ?? item.price ?? 0);
      const qty = safeStock(stockFlat);
      const price = typeof costFlat === 'number' && !isNaN(costFlat) ? costFlat : 0;
      return sum + qty * price;
    } catch (e) {
      return sum;
    }
  }, 0);

  // Round to 2 decimals to avoid floating point drift
  return Math.round(total * 100) / 100;
};

/**
 * Validates and sanitizes an inventory item's numeric fields
 */
export const sanitizeInventoryItem = <T extends { stock?: number; threshold?: number }>(item: T): T => {
  return {
    ...item,
    stock: safeStock(item.stock),
    threshold: safeThreshold(item.threshold)
  };
};

/**
 * Sorts inventory by usage priority:
 * 1) totalUsed (desc)
 * 2) usageCount (desc)
 * 3) lastUsed (newer first)
 * 4) Items with no usage (all zeros / no lastUsed) are pushed to the end
 * 5) tie-breaker: stock (ascending) then name (alphabetical)
 */
export const sortByUsage = <T extends { totalUsed?: number; usageCount?: number; lastUsed?: string; stock?: number; name?: string }>(items: T[]): T[] => {
  const copy = Array.isArray(items) ? [...items] : [];
  copy.sort((a, b) => {
    const aTotal = a.totalUsed || 0;
    const bTotal = b.totalUsed || 0;
    if (aTotal !== bTotal) return bTotal - aTotal;

    const aCount = a.usageCount || 0;
    const bCount = b.usageCount || 0;
    if (aCount !== bCount) return bCount - aCount;

    const aLast = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
    const bLast = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
    if (aLast !== bLast) return bLast - aLast;

    // push items with no usage data to the end
    const aHasUsage = (aTotal || aCount || aLast) ? 1 : 0;
    const bHasUsage = (bTotal || bCount || bLast) ? 1 : 0;
    if (aHasUsage !== bHasUsage) return bHasUsage - aHasUsage;

    // tie-break by stock (lower stock first)
    const aStock = typeof a.stock === 'number' ? a.stock : 0;
    const bStock = typeof b.stock === 'number' ? b.stock : 0;
    if (aStock !== bStock) return aStock - bStock;

    // final fallback: alphabetical by name
    return (a.name || '').toString().localeCompare((b.name || '').toString());
  });
  return copy;
};
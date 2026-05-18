import React, { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import InventoryTable from '../components/InventoryTable';
import { InventoryItem } from '../types';

const LowStockView: React.FC = () => {
    const { state, selectItem } = useAppContext();
    
    // Get all low stock items sorted by usage priority
    const lowStockItems = useMemo(() => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        return state.inventory
            .filter(item => item.stock <= item.threshold)
            .sort((a, b) => {
                // Sort by usage priority: total used (descending), then usage count (descending), then last used (most recent first)
                const aUsed = a.totalUsed || 0;
                const bUsed = b.totalUsed || 0;
                if (aUsed !== bUsed) return bUsed - aUsed;
                
                const aCount = a.usageCount || 0;
                const bCount = b.usageCount || 0;
                if (aCount !== bCount) return bCount - aCount;
                
                const aLastUsed = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
                const bLastUsed = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
                return bLastUsed - aLastUsed;
            });
    }, [state.inventory]);
    
    const handleItemClick = (item: InventoryItem) => {
        selectItem(item.id);
    };
    
    const totalValue = useMemo(() => {
        return lowStockItems.reduce((sum, item) => sum + (item.totalUsed || 0), 0);
    }, [lowStockItems]);
    
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Low Stock Items</h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-2">
                        All items below their reorder threshold, prioritized by usage and importance
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Low Stock Items</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">{lowStockItems.length}</p>
                </div>
            </div>
            
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Critical (0 stock)</h3>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {lowStockItems.filter(item => item.stock <= 0).length}
                    </p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Recently Used (30 days)</h3>
                    <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                        {lowStockItems.filter(item => {
                            if (!item.lastUsed) return false;
                            const thirtyDaysAgo = new Date();
                            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                            return new Date(item.lastUsed) >= thirtyDaysAgo;
                        }).length}
                    </p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Units Used</h3>
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {totalValue.toLocaleString()}
                    </p>
                </div>
            </div>
            
            {/* Items Table */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                {lowStockItems.length > 0 ? (
                    <InventoryTable 
                        inventory={lowStockItems} 
                        onItemClick={handleItemClick}
                    />
                ) : (
                    <div className="text-center py-12">
                        <div className="text-6xl mb-4">🎉</div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                            No Low Stock Items
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400">
                            All items are currently above their reorder thresholds.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LowStockView;
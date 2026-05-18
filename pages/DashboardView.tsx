import React, { useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import SummaryCard from '../components/SummaryCard';
import AiSuggestions from '../components/AiSuggestions';
import InventoryTable from '../components/InventoryTable';
import LowStockAlert from '../components/LowStockAlert';
import AnalyticsCards from '../components/AnalyticsCards';
import { InventoryItem, View } from '../types';
import { calculateTotalValue } from '../utils/inventoryUtils';

const ExternalLinkIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15,3 21,3 21,9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>;

const LowStockItemsTable: React.FC<{ items: InventoryItem[], onItemClick: (item: InventoryItem) => void, showViewAll?: boolean, onViewAll?: () => void }> = ({ 
    items, 
    onItemClick, 
    showViewAll = false, 
    onViewAll 
}) => {
    if (items.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500">No low stock items found that were used in the past 30 days.</div>;
    }
    
    return (
        <div>
            <InventoryTable 
                inventory={items}
                onItemClick={onItemClick}
            />
            {showViewAll && (
                <div className="mt-4 text-center">
                    <button 
                        onClick={onViewAll}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                    >
                        View All Low Stock Items
                        <ExternalLinkIcon />
                    </button>
                </div>
            )}
        </div>
    );
};

const DashboardView: React.FC = () => {
    const { state, selectItem, setView } = useAppContext();
    const { inventory } = state;
    
    const [isAlertVisible, setIsAlertVisible] = useState(true);

    // Smart low stock filtering: items used in the past 30 days
    const smartLowStockItems = useMemo(() => {
        if (!inventory || !Array.isArray(inventory)) return [];
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        console.log('📊 Dashboard inventory analysis:', {
            totalItems: inventory.length,
            itemsWithPositiveStock: inventory.filter(item => item.stock > 0).length,
            itemsWithNegativeStock: inventory.filter(item => item.stock < 0).length,
            totalStock: inventory.reduce((sum, item) => sum + item.stock, 0),
            lowStockItems: inventory.filter(item => item.stock <= item.threshold).length,
            negativeStockItems: inventory.filter(item => item.stock < 0).length
        });

        // Log some sample items to verify data structure
        if (inventory.length > 0) {
            console.log('📦 Sample inventory items:', inventory.slice(0, 3).map(item => ({
                name: item.name,
                description: item.description,
                displayName: item.description || item.name,
                stock: item.stock,
                threshold: item.threshold,
                isLowStock: item.stock <= item.threshold,
                isNegative: item.stock < 0,
                unit: item.unit,
                lastUsed: item.lastUsed,
                usageCount: item.usageCount
            })));
        }
        
        const lowStockItems = inventory.filter(item => item.stock <= item.threshold);
        console.log(`⚠️ Found ${lowStockItems.length} low stock items`);

        const filteredItems = lowStockItems
            .filter(item => {
                // Check if item was used in the past 30 days
                if (item.lastUsed) {
                    const lastUsedDate = new Date(item.lastUsed);
                    return lastUsedDate >= thirtyDaysAgo;
                }
                // If no lastUsed data, include items with usage count > 0 as fallback
                // Or include all items if they have no usage data yet (new imports)
                return (item.usageCount || 0) > 0 || !item.lastUsed;
            })
            .sort((a, b) => {
                // Sort by usage priority: totalUsed -> usageCount -> lastUsed -> stock level
                const aTotalUsed = a.totalUsed || 0;
                const bTotalUsed = b.totalUsed || 0;
                if (aTotalUsed !== bTotalUsed) return bTotalUsed - aTotalUsed;
                
                const aUsageCount = a.usageCount || 0;
                const bUsageCount = b.usageCount || 0;
                if (aUsageCount !== bUsageCount) return bUsageCount - aUsageCount;
                
                const aLastUsed = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
                const bLastUsed = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
                if (aLastUsed !== bLastUsed) return bLastUsed - aLastUsed;
                
                // Finally sort by stock level (lowest first for urgency)
                return a.stock - b.stock;
            })
            .slice(0, 20); // Limit to 20 items for dashboard

        console.log(`🎯 Dashboard showing ${filteredItems.length} priority low stock items`);
        
        return filteredItems;
    }, [inventory]);

    // All low stock items for alert count - with null safety
    const allLowStockItems = useMemo(() => 
        (inventory || []).filter(item => 
            typeof item.stock === 'number' && 
            typeof item.threshold === 'number' && 
            item.stock <= item.threshold
        ), [inventory]);
    
    // FIX BUG-DASH-001: Count items, not sum of stock quantities
    const totalItems = useMemo(() => (inventory || []).length, [inventory]);
    const outOfStockCount = useMemo(() => (inventory || []).filter(item => item.stock <= 0).length, [inventory]);
    
    // Calculate total inventory value using centralized util
    const totalInventoryValue = useMemo(() => calculateTotalValue(inventory || []), [inventory]);

    const lowStockCount = allLowStockItems.length;
    
    const handleItemClick = (item: InventoryItem) => {
        selectItem(item.id);
    };

    const handleViewAllLowStock = () => {
        setView(View.LowStock);
    };

    const handleNavigateToCategories = () => {
        setView(View.Categories);
    };

    const handleNavigateToInventory = () => {
        setView(View.Inventory);
    };

    const handleNavigateToOutOfStock = () => {
        // Navigate to inventory with out of stock filter
        setView(View.Inventory);
        // TODO: We could pass filter params here if the inventory view supports it
    };

    return (
        <div className="space-y-6">
            {isAlertVisible && lowStockCount > 0 && (
                <LowStockAlert count={lowStockCount} onClose={() => setIsAlertVisible(false)} />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                <SummaryCard 
                    title="Out of Stock Items" 
                    value={outOfStockCount} 
                    delay={0} 
                    clickable={true}
                    onClick={handleNavigateToOutOfStock}
                />
                <SummaryCard 
                    title="Total Items" 
                    value={totalItems.toLocaleString()} 
                    delay={300} 
                    clickable={true}
                    onClick={handleNavigateToInventory}
                />
                <SummaryCard 
                    title="Item Categories" 
                    value={new Set((inventory || []).map(i => i.category)).size} 
                    delay={600} 
                    clickable={true}
                    onClick={handleNavigateToCategories}
                />
                <SummaryCard 
                    title="Low Stock Items" 
                    value={lowStockCount} 
                    delay={900} 
                    clickable={true}
                    onClick={handleViewAllLowStock}
                />
                <SummaryCard 
                    title="Recently Updated" 
                    value={(inventory || []).filter(item => {
                        const lastUpdated = new Date(item.lastUpdated || 0);
                        const sevenDaysAgo = new Date();
                        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                        return lastUpdated >= sevenDaysAgo;
                    }).length}
                    delay={1200} 
                    clickable={true}
                    onClick={handleNavigateToInventory}
                />
            </div>
            {/* Always show comprehensive analytics */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <AnalyticsCards 
                    inventory={inventory || []} 
                    activityLogs={state.activityLogs || []}
                    autoRefresh={state.settings?.analytics?.autoRefresh || false}
                    refreshInterval={state.settings?.analytics?.refreshInterval || 30}
                />
            </div>

            {/* Priority Low Stock Items Section - Show when present */}
            {smartLowStockItems.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-200">⚠️ Priority Low Stock Items</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Items used in past 30 days that need restocking</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200">
                                    {smartLowStockItems.length} urgent
                                </span>
                                {lowStockCount > smartLowStockItems.length && (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200">
                                        +{lowStockCount - smartLowStockItems.length} more
                                    </span>
                                )}
                            </div>
                        </div>
                        <LowStockItemsTable 
                            items={smartLowStockItems} 
                            onItemClick={handleItemClick}
                            showViewAll={lowStockCount > smartLowStockItems.length}
                            onViewAll={handleViewAllLowStock}
                        />
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg flex flex-col">
                        <AiSuggestions lowStockItems={smartLowStockItems} />
                    </div>
                </div>
            )}

            {/* Inventory Optimization Section - Always show */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-200 mb-4">
                        🎯 Inventory Status
                    </h3>
                    <div className="space-y-4">
                        {smartLowStockItems.length === 0 ? (
                            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                                <h4 className="font-medium text-green-800 dark:text-green-200">✅ Excellent Stock Management</h4>
                                <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                                    No critical low stock items detected. Your inventory levels are well-maintained.
                                </p>
                            </div>
                        ) : (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                                <h4 className="font-medium text-red-800 dark:text-red-200">⚠️ Action Required</h4>
                                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                                    {smartLowStockItems.length} priority items need restocking. Check the suggestions for recommended quantities.
                                </p>
                            </div>
                        )}
                        
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                            <h4 className="font-medium text-blue-800 dark:text-blue-200">💡 Optimization Tip</h4>
                            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                                {smartLowStockItems.length === 0 
                                    ? "Consider reviewing slow-moving items to optimize storage space and reduce carrying costs."
                                    : "Focus on the priority items shown above - they're your most actively used products running low."
                                }
                            </p>
                        </div> 
                    </div>
                </div>
                
                
            </div>
        </div>
    );
};

export default DashboardView;
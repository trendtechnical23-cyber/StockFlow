import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import * as apiService from '../services/apiService';
import { InventoryItem, PriorityItem } from '../types';
import { useToast } from '../hooks/useToast';
import useNotifications from '../hooks/useNotifications';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';

// Dynamic color palette for categories
const COLOR_PALETTE = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#10B981', 
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
  '#F59E0B', '#84CC16', '#06B6D4', '#6366F1', '#8B5CF6',
  '#EC4899', '#EF4444', '#F97316', '#EAB308', '#22C55E'
];

const PriorityItemsView: React.FC = () => {
  const { state, dispatch } = useAppContext();
  const { currentOrganization, inventory, categories: globalCategories } = state;
  
  // Get unique categories from both global categories and inventory items
  const PRIORITY_CATEGORIES = useMemo(() => {
    const categorySet = new Set<string>();
    
    // Add global categories (created in Categories page)
    (globalCategories || []).forEach(category => {
      if (category && category.trim() !== '') {
        categorySet.add(category);
      }
    });
    
    // Add categories from inventory items
    inventory.forEach(item => {
      if (item.category && item.category.trim() !== '') {
        categorySet.add(item.category);
      }
    });
    
    return Array.from(categorySet).sort();
  }, [inventory, globalCategories]);

  // Create dynamic color mapping for categories
  const categoryColors = useMemo(() => {
    const colorMap: Record<string, string> = {};
    PRIORITY_CATEGORIES.forEach((category, index) => {
      colorMap[category] = COLOR_PALETTE[index % COLOR_PALETTE.length];
    });
    colorMap['default'] = '#64748B';
    return colorMap;
  }, [PRIORITY_CATEGORIES]);
  
  const [priorityItems, setPriorityItems] = useState<PriorityItem[]>([]);
  const [inventoryState, setInventoryState] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [note, setNote] = useState('');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [selectedCategoryForModal, setSelectedCategoryForModal] = useState<string>('');
  const addToast = useToast();
  const { sendTestNotification } = useNotifications();
  
  // Helper function to get category color (with fallback)
  const getCategoryColor = (category: string): string => {
    return categoryColors[category] || categoryColors['default'];
  };

  const filteredInventory = useMemo(() => {
    if (!searchTerm.trim()) return [];
    
    const term = searchTerm.toLowerCase().trim();
    const filtered = inventoryState.filter(item => 
      (item.name && item.name.toLowerCase().includes(term)) || 
      (item.sku && item.sku.toLowerCase().includes(term)) || 
      (item.description && item.description.toLowerCase().includes(term))
    );
    
    // Debug: Log search results
    if (searchTerm.length > 0) {
      console.log(`🔍 Searching for "${searchTerm}" in ${inventoryState.length} items, found ${filtered.length} matches`);
    }
    
    return filtered;
  }, [inventoryState, searchTerm]);

  const inventoryMap = inventoryState.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {} as Record<string, InventoryItem>);

  const fetchPriorityItems = useCallback(async () => {
    if (!currentOrganization) return;
    setLoading(true);
    try {
      const items = await apiService.getPriorityItems(currentOrganization.id);
      // Join with inventory to get item names
      const populatedItems = items.map((pItem: any) => {
        const inventoryItem = inventoryState.find(invItem => invItem.id === pItem.itemId);
        return {
          ...pItem,
          name: inventoryItem?.name || 'Unknown Item',
          sku: inventoryItem?.sku || 'N/A',
          // Keep the priority item's category, don't overwrite from inventory
        };
      });
      setPriorityItems(populatedItems);
    } catch (error) {
      console.error('Failed to fetch priority items', error);
      addToast('Failed to load priority items.', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentOrganization, addToast, inventoryState]);

  const fetchInventory = useCallback(async () => {
    if (!currentOrganization) return;
    try {
        console.log('📦 Fetching inventory for priority items...');
        const orgData = await apiService.getOrganizationData(currentOrganization.id);
        console.log(`✅ Loaded ${orgData.inventory.length} items for search`);
        setInventoryState(orgData.inventory);
    } catch (error) {
        console.error('Failed to fetch inventory', error);
        addToast('Failed to load inventory for priority selection.', 'error');
    }
  }, [currentOrganization, addToast]);


  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  useEffect(() => {
    if (inventoryState.length > 0) {
        fetchPriorityItems();
    }
  }, [inventoryState, fetchPriorityItems]);

  // Initialize selectedCategory when PRIORITY_CATEGORIES changes
  useEffect(() => {
    if (PRIORITY_CATEGORIES.length > 0 && !selectedCategory) {
      setSelectedCategory(PRIORITY_CATEGORIES[0]);
    }
  }, [PRIORITY_CATEGORIES, selectedCategory]);

  // Monitor for priority items below threshold and show notification alerts
  useEffect(() => {
    const belowThresholdItems = priorityItems
      .map(p => ({ ...p, invItem: inventoryMap[p.itemId] }))
      .filter(({ invItem }) => invItem && invItem.stock <= invItem.threshold);

    if (belowThresholdItems.length > 0) {
      const highPriorityCount = belowThresholdItems.filter(p => p.priority === 'High').length;
      const mediumPriorityCount = belowThresholdItems.filter(p => p.priority === 'Medium').length;

      // Show a subtle info toast only if there are items to warn about
      if (highPriorityCount > 0) {
        addToast(
          `⚠️ ${highPriorityCount} HIGH priority item${highPriorityCount !== 1 ? 's' : ''} below threshold!`,
          'error'
        );
      } else if (mediumPriorityCount > 0) {
        addToast(
          `📌 ${mediumPriorityCount} priority item${mediumPriorityCount !== 1 ? 's' : ''} below threshold`,
          'info'
        );
      }
    }
  }, [priorityItems, inventoryMap, addToast]);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganization || !selectedItem) {
      addToast('Please select an item.', 'error');
      return;
    }

    setLoading(true);
    try {
      await apiService.addPriorityItem(currentOrganization.id, selectedItem, selectedCategory, note);
      addToast('Priority item added successfully!', 'success');
      setSelectedItem('');
      setSelectedCategory(PRIORITY_CATEGORIES.length > 0 ? PRIORITY_CATEGORIES[0] : '');
      setNote('');
      setSearchTerm('');
      fetchPriorityItems();
    } catch (error) {
      console.error('Failed to add priority item', error);
      addToast('Failed to add priority item.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveItem = async (priorityId: string) => {
    if (!currentOrganization) return;
    setLoading(true);
    try {
      await apiService.removePriorityItem(currentOrganization.id, priorityId);
      addToast('Priority item removed.', 'success');
      fetchPriorityItems(); // Refresh list
    } catch (error) {
      console.error('Failed to remove priority item', error);
      addToast('Failed to remove priority item.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCategory = async (priorityId: string, newCategory: string) => {
    if (!currentOrganization) return;
    try {
      await apiService.updatePriorityItem(currentOrganization.id, priorityId, { category: newCategory });
      addToast('Category updated.', 'success');
      fetchPriorityItems();
    } catch (error) {
      console.error('Failed to update category', error);
      addToast('Failed to update category.', 'error');
    }
  };

  const handleCategoryClick = (category: string) => {
    setSelectedCategoryForModal(category);
    setCategoryModalOpen(true);
  };

  // Build category statistics for graphs
  const categoryStats = useMemo(() => {
    const stats: Record<string, {
      category: string;
      itemCount: number;
      totalStock: number;
      totalThreshold: number;
      belowThreshold: number;
      aboveThreshold: number;
      stockPercentage: number;
      color: string;
    }> = {};

    PRIORITY_CATEGORIES.forEach(cat => {
      const itemsInCat = priorityItems.filter(item => item.category === cat);
      const inventoryItemsInCat = itemsInCat
        .map(pItem => inventoryMap[pItem.itemId])
        .filter((item): item is InventoryItem => !!item);

      const totalStock = inventoryItemsInCat.reduce((sum, item) => sum + (item.stock || 0), 0);
      const totalThreshold = inventoryItemsInCat.reduce((sum, item) => sum + (item.threshold || 0), 0);
      const belowThreshold = inventoryItemsInCat.filter(item => item.stock <= item.threshold).length;
      
      stats[cat] = {
        category: cat,
        itemCount: itemsInCat.length,
        totalStock,
        totalThreshold,
        belowThreshold,
        aboveThreshold: itemsInCat.length - belowThreshold,
        stockPercentage: totalThreshold > 0 ? Math.round((totalStock / totalThreshold) * 100) : 0,
        color: getCategoryColor(cat)
      };
    });

    return stats;
  }, [priorityItems, inventoryMap, PRIORITY_CATEGORIES]);

  const categoryStatsArray = (Object.values(categoryStats) as any[]).filter((stat: any) => stat.itemCount > 0);
  const categoryDistribution = categoryStatsArray.map((stat: any) => ({
    name: stat.category,
    value: stat.itemCount,
    fill: stat.color
  }));

  const stockStatusByCategory = categoryStatsArray.map((stat: any) => ({
    category: stat.category.substring(0, 10),
    'Below Threshold': stat.belowThreshold,
    'Above Threshold': stat.aboveThreshold,
    fill: stat.color
  }));

  // Custom tooltips for graphs
  const CustomPieTooltip = (props: any) => {
    const { active, payload } = props;
    if (active && payload && payload.length) {
      const categoryName = payload[0].name;
      const itemsInCategory = priorityItems.filter(item => item.category === categoryName);
      return (
        <div className="bg-white dark:bg-gray-900 p-3 rounded shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-800 dark:text-white">{categoryName}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">Total Items: {payload[0].value}</p>
          <div className="mt-2 max-h-48 overflow-y-auto">
            {itemsInCategory.map((item, idx) => {
              const invItem = inventoryMap[item.itemId];
              return (
                <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                  <div className="font-medium">{item.sku}</div>
                  <div className="text-gray-500 dark:text-gray-500">Qty: {invItem?.stock || 0}/{invItem?.threshold || 0}</div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomBarTooltip = (props: any) => {
    const { active, payload, label } = props;
    if (active && payload && payload.length) {
      const fullCategoryName = PRIORITY_CATEGORIES.find(cat => cat.substring(0, 10) === label) || label;
      const itemsInCategory = priorityItems.filter(item => item.category === fullCategoryName);
      const belowThreshold = payload.find((p: any) => p.name === 'Below Threshold')?.value || 0;
      const aboveThreshold = payload.find((p: any) => p.name === 'Above Threshold')?.value || 0;
      
      return (
        <div className="bg-white dark:bg-gray-900 p-3 rounded shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-800 dark:text-white">{fullCategoryName}</p>
          <p className="text-sm text-red-600 dark:text-red-400">Below Threshold: {belowThreshold}</p>
          <p className="text-sm text-green-600 dark:text-green-400">Above Threshold: {aboveThreshold}</p>
          <div className="mt-2 max-h-48 overflow-y-auto">
            {itemsInCategory.map((item, idx) => {
              const invItem = inventoryMap[item.itemId];
              const isBelowThreshold = invItem && invItem.stock <= invItem.threshold;
              return (
                <div 
                  key={idx} 
                  className={`text-xs border-t border-gray-200 dark:border-gray-700 pt-1 mt-1 ${
                    isBelowThreshold 
                      ? 'text-red-600 dark:text-red-400' 
                      : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  <div className="font-medium">{item.sku}</div>
                  <div className="text-gray-500 dark:text-gray-500">Qty: {invItem?.stock || 0}/{invItem?.threshold || 0}</div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-white">Priority Items by Category</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-300">Total Items</div>
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{priorityItems.length}</div>
        </div>
        <div className="p-4 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-300">Below Threshold</div>
          <div className="text-3xl font-bold text-red-600 dark:text-red-400">
            {Object.values(categoryStats as any).reduce((sum: number, stat: any) => sum + stat.belowThreshold, 0)}
          </div>
        </div>
        <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-300">Categories Used</div>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">{categoryStatsArray.length}</div>
        </div>
        <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-300">Avg Stock Level</div>
          <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {categoryStatsArray.length > 0 
              ? Math.round((categoryStatsArray.reduce((sum: number, stat: any) => sum + stat.stockPercentage, 0) / categoryStatsArray.length) as number)
              : 0}%
          </div>
        </div>
      </div>

      {/* Interactive Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Category Distribution Pie Chart */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white">Items by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            {(categoryDistribution as any).length > 0 ? (
              <PieChart>
                <Pie
                  data={categoryDistribution as any}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry: any) => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {(categoryDistribution as any).map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<CustomPieTooltip />} />
              </PieChart>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No data available</div>
            )}
          </ResponsiveContainer>
        </div>

        {/* Stock Status by Category */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white">Stock Status by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            {(stockStatusByCategory as any).length > 0 ? (
              <BarChart data={stockStatusByCategory as any}>
                <XAxis dataKey="category" />
                <YAxis />
                <Tooltip content={<CustomBarTooltip />} />
                <Legend />
                <Bar dataKey="Below Threshold" stackId="a" fill="#EF4444" />
                <Bar dataKey="Above Threshold" stackId="a" fill="#10B981" />
              </BarChart>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No data available</div>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category Grid with Individual Stats */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white">Category Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {PRIORITY_CATEGORIES.map(category => {
            const stat = (categoryStats as any)[category];
            if (!stat) return null;
            return (
              <button
                key={category}
                onClick={() => handleCategoryClick(category)}
                className="p-3 bg-white dark:bg-gray-800 rounded-lg shadow border-l-4 text-left hover:shadow-lg transition-all duration-200 transform hover:scale-105 cursor-pointer"
                style={{ borderColor: stat.color }}
              >
                <div className="font-semibold text-sm text-gray-800 dark:text-white truncate">{category}</div>
                <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">{stat.itemCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {stat.belowThreshold > 0 && <span className="text-red-600 dark:text-red-400">{stat.belowThreshold} below threshold</span>}
                  {stat.belowThreshold === 0 && stat.itemCount > 0 && <span className="text-green-600 dark:text-green-400">All healthy</span>}
                  {stat.itemCount === 0 && <span className="text-gray-400 dark:text-gray-500">No items</span>}
                </div>
                <div className="mt-2">
                  <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{ width: `${stat.stockPercentage}%`, backgroundColor: stat.color }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{stat.stockPercentage}% stock</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200">Add New Priority Item</h2>
            <form onSubmit={handleAddItem}>
              <div className="mb-4">
                <label htmlFor="item-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Search Item (Name, SKU, Description)
                </label>
                <div className="relative">
                  <input
                    id="item-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                    placeholder="Search by name, SKU, or description..."
                    autoComplete="off"
                  />
                  {searchTerm && filteredInventory.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Found {filteredInventory.length} item{filteredInventory.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
                {searchTerm && filteredInventory.length > 0 && (
                  <div className="mt-2 border border-gray-300 dark:border-gray-600 rounded-md overflow-y-auto max-h-48 shadow-md">
                    {filteredInventory.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          setSelectedItem(item.id);
                          setSearchTerm('');
                        }}
                        className={`px-4 py-3 cursor-pointer transition-colors ${
                          selectedItem === item.id
                            ? 'bg-indigo-500 text-white'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{item.name}</div>
                            <div className="text-xs opacity-75">SKU: {item.sku}</div>
                          </div>
                          <div className="text-xs opacity-75">
                            {item.stock}/{item.threshold}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {searchTerm && filteredInventory.length === 0 && (
                  <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-md text-sm text-gray-500 dark:text-gray-400 text-center">
                    No items found matching "{searchTerm}"
                  </div>
                )}
                {selectedItem && !searchTerm && (
                  <div className="mt-2 p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-md">
                    <div className="text-xs text-indigo-600 dark:text-indigo-300">
                      Selected: <span className="font-semibold">{inventory.find(i => i.id === selectedItem)?.name || 'Unknown'}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Category
                </label>
                <select
                  id="category"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                  required
                >
                  {PRIORITY_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="mb-6">
                <label htmlFor="note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Note (Optional)
                </label>
                <textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Adding...' : 'Add Item'}
              </button>
            </form>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <h2 className="text-xl font-semibold p-6 text-gray-700 dark:text-gray-200">Current Priority List</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Item</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Category</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stock Status</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Note</th>
                    <th scope="col" className="relative px-6 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {priorityItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No priority items yet.
                      </td>
                    </tr>
                  ) : (
                    priorityItems.map((item) => {
                      const invItem = inventoryMap[item.itemId];
                      const isBelowThreshold = invItem && invItem.stock <= invItem.threshold;
                      const stockStatus = isBelowThreshold ? `${invItem.stock}/${invItem.threshold} (LOW)` : `${invItem?.stock || 'N/A'} in stock`;
                      return (
                        <tr key={item.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{item.sku}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <select
                              value={item.category}
                              onChange={(e) => handleUpdateCategory(item.id, e.target.value)}
                              className="px-2 py-1 text-xs border-2 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              style={{ borderColor: getCategoryColor(item.category) }}
                            >
                              {PRIORITY_CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={isBelowThreshold ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-green-600 dark:text-green-400'}>
                              {stockStatus}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">{item.note || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                              disabled={loading}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Category Items Modal */}
      {categoryModalOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setCategoryModalOpen(false)}
        >
          <div 
            className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-800 dark:text-white">{selectedCategoryForModal}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {priorityItems.filter(item => item.category === selectedCategoryForModal).length} items in this category
                </p>
              </div>
              <button
                onClick={() => setCategoryModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
              {priorityItems.filter(item => item.category === selectedCategoryForModal).length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No items in this category yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {priorityItems
                    .filter(item => item.category === selectedCategoryForModal)
                    .map(item => {
                      const invItem = inventoryMap[item.itemId];
                      const isBelowThreshold = invItem && invItem.stock <= invItem.threshold;
                      const stockPercentage = invItem && invItem.threshold > 0 
                        ? Math.round((invItem.stock / invItem.threshold) * 100) 
                        : 0;
                      
                      return (
                        <div 
                          key={item.id} 
                          className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border-l-4 transition-all hover:shadow-md"
                          style={{ 
                            borderColor: isBelowThreshold 
                              ? '#EF4444' 
                              : stockPercentage < 50 
                                ? '#F59E0B' 
                                : '#10B981' 
                          }}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h4 className="font-semibold text-gray-900 dark:text-white">{item.name}</h4>
                              <p className="text-sm text-gray-500 dark:text-gray-400">{item.sku}</p>
                              {item.note && (
                                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">Note: {item.note}</p>
                              )}
                            </div>
                            <div className="ml-4 text-right">
                              <div className={`text-lg font-bold ${
                                isBelowThreshold 
                                  ? 'text-red-600 dark:text-red-400' 
                                  : stockPercentage < 50
                                    ? 'text-yellow-600 dark:text-yellow-400'
                                    : 'text-green-600 dark:text-green-400'
                              }`}>
                                {invItem?.stock || 0}/{invItem?.threshold || 0}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {stockPercentage}%
                              </div>
                            </div>
                          </div>
                          
                          {/* Stock level bar */}
                          <div className="mt-3">
                            <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                              <div
                                className="h-full transition-all duration-300"
                                style={{
                                  width: `${Math.min(stockPercentage, 100)}%`,
                                  backgroundColor: isBelowThreshold 
                                    ? '#EF4444' 
                                    : stockPercentage < 50 
                                      ? '#F59E0B' 
                                      : '#10B981'
                                }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <button
                onClick={() => setCategoryModalOpen(false)}
                className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PriorityItemsView;

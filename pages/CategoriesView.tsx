import React, { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { InventoryItem, View } from '../types';
import InventoryTable from '../components/InventoryTable';

interface Category {
  id: string;
  name: string;
  description: string;
  itemCount: number;
  items: InventoryItem[];
  createdAt: Date;
}

const CategoriesView: React.FC = () => {
  const { state, handleUpdateItem, selectItem, setView, handleUpdateCategories } = useAppContext();
  const { inventory, currentOrganization, categories: globalCategories } = state;
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showItemAssignment, setShowItemAssignment] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [unassignedItems, setUnassignedItems] = useState<InventoryItem[]>([]);
  const [assignmentSearchTerm, setAssignmentSearchTerm] = useState('');

  // Get category counts from current inventory
  const getCategoryStats = () => {
    const categoryStats = new Map<string, number>();
    inventory.forEach(item => {
      if (item.category && item.category.trim() !== '') {
        categoryStats.set(item.category, (categoryStats.get(item.category) || 0) + 1);
      }
    });
    return categoryStats;
  };

  const loadCategories = async () => {
    try {
      setLoading(true);
      const categoryStats = getCategoryStats();
      
      // Get unique categories from current inventory, excluding empty/null categories
      const inventoryCategories = Array.from(new Set(
        inventory.map(item => item.category).filter(category => category && category.trim() !== '')
      )) as string[];

      // Combine global categories with inventory categories
      const allCategoryNames = Array.from(new Set([
        ...(globalCategories || []),
        ...inventoryCategories
      ])).filter(category => category && category.trim() !== '');

      // Create category objects with stats and items
      const categoriesData: Category[] = allCategoryNames.map((categoryName: string) => {
        const categoryItems = inventory.filter(item => 
          item.category === categoryName
        );
        return {
          id: categoryName.toLowerCase().replace(/\s+/g, '-'),
          name: categoryName,
          description: categoryItems.length > 0 
            ? `${categoryItems.length} items in ${categoryName} category`
            : `${categoryName} category (no items assigned yet)`,
          itemCount: categoryItems.length,
          items: categoryItems,
          createdAt: new Date()
        };
      });

      // Sort by item count (most items first)
      categoriesData.sort((a, b) => b.itemCount - a.itemCount);
      
      // Add "Unassigned" category at the top if there are unassigned items
      const unassigned = inventory.filter(item => !item.category || item.category.trim() === '' || item.category === 'Other');
      if (unassigned.length > 0) {
        categoriesData.unshift({
          id: 'unassigned',
          name: 'Unassigned',
          description: `${unassigned.length} items need category assignment`,
          itemCount: unassigned.length,
          items: unassigned,
          createdAt: new Date()
        });
      }
      
      setCategories(categoriesData);
      
      // Update unassigned items state using the same unassigned array
      setUnassignedItems(unassigned);
    } catch (error) {
      console.error('Error loading categories:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, [inventory, globalCategories]);

  // Filter unassigned items based on search term
  const filteredUnassignedItems = useMemo(() => {
    if (!assignmentSearchTerm.trim()) {
      return unassignedItems;
    }
    const searchLower = assignmentSearchTerm.toLowerCase();
    return unassignedItems.filter(item => 
      item.name.toLowerCase().includes(searchLower) ||
      item.sku.toLowerCase().includes(searchLower) ||
      (item.description && item.description.toLowerCase().includes(searchLower)) ||
      (item.brand && item.brand.toLowerCase().includes(searchLower)) ||
      (item.location && item.location.toLowerCase().includes(searchLower))
    );
  }, [unassignedItems, assignmentSearchTerm]);

  const handleAddCategory = async () => {
    if (!formData.name.trim()) return;
    
    const newCategoryName = formData.name.trim();
    
    // Add to global categories
    const updatedCategories = [...(globalCategories || []), newCategoryName];
    await handleUpdateCategories(updatedCategories);
    
    // Also add to local categories for immediate UI update
    const newCategory: Category = {
      id: Date.now().toString(),
      name: newCategoryName,
      description: formData.description.trim() || `Items in ${newCategoryName} category`,
      itemCount: 0,
      items: [],
      createdAt: new Date()
    };

    setCategories(prev => [...prev, newCategory]);
    setFormData({ name: '', description: '' });
    setShowAddForm(false);
  };

  const handleUpdateCategory = (category: Category) => {
    setCategories(prev => prev.map(c => c.id === category.id ? {
      ...category,
      items: c.items // Preserve existing items
    } : c));
    setEditingCategory(null);
  };

  const handleDeleteCategory = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;

    if (category.itemCount > 0) {
      alert(`Cannot delete "${category.name}" because it contains ${category.itemCount} items. Please move or delete those items first.`);
      return;
    }

    if (confirm(`Are you sure you want to delete the "${category.name}" category?`)) {
      setCategories(prev => prev.filter(c => c.id !== categoryId));
    }
  };

  const handleAssignItemToCategory = async (item: InventoryItem, categoryName: string) => {
    const updatedItem = { ...item, category: categoryName };
    await handleUpdateItem(updatedItem);
    loadCategories(); // Refresh categories
  };

  const handleItemClick = (item: InventoryItem) => {
    selectItem(item.id);
    setView(View.ItemDetail);
  };

  const handleViewCategory = (category: Category) => {
    setSelectedCategory(category.name);
  };

  const handleBackToCategories = () => {
    setSelectedCategory(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Show specific category items if selected
  if (selectedCategory) {
    const category = categories.find(c => c.name === selectedCategory);
    if (!category) {
      setSelectedCategory(null);
      return null;
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBackToCategories}
            className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Categories
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{category.name}</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              {category.itemCount} items in this category
            </p>
          </div>
        </div>

        {category.items.length > 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <InventoryTable 
              inventory={category.items}
              onItemClick={handleItemClick}
            />
          </div>
        ) : (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg">
            <div className="text-gray-400 dark:text-gray-500 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              No items in this category
            </h3>
            <p className="text-gray-500 dark:text-gray-400">
              Items will appear here when assigned to this category
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Item Categories</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Manage and organize your inventory categories
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowItemAssignment(true)}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
          >
            Assign Items
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Add Category
          </button>
        </div>
      </div>

      {/* Add Category Form */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg border">
          <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Add New Category</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Category Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                         dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500"
                placeholder="Enter category name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description (Optional)
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                         dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500"
                placeholder="Enter category description"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddCategory}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
              >
                Add Category
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({ name: '', description: '' });
                }}
                className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {categories.map((category) => (
          <div
            key={category.id}
            className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-200 
                     dark:border-gray-700 hover:shadow-xl transition-all cursor-pointer group"
            onClick={() => handleViewCategory(category)}
          >
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                  {category.name}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                  {category.description}
                </p>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setEditingCategory(category)}
                  className="text-indigo-600 hover:text-indigo-800 p-1"
                  title="Edit Category"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDeleteCategory(category.id)}
                  className="text-red-600 hover:text-red-800 p-1"
                  title="Delete Category"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                {category.itemCount}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  items
                </span>
                <svg className="w-4 h-4 text-gray-400 group-hover:text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        ))}

        {/* Unassigned Items Alert Card - Show prominently at top */}
        {unassignedItems.length > 0 && (
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 p-6 rounded-lg shadow-lg border-2 border-dashed border-yellow-400 dark:border-yellow-600 mb-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-yellow-800 dark:text-yellow-300">
                  {unassignedItems.length} Items Need Category Assignment
                </h3>
                <p className="text-yellow-700 dark:text-yellow-400 text-sm mt-1">
                  These items don't have categories yet. Assign them to organize your inventory better.
                </p>
              </div>
              <div className="flex-shrink-0">
                <button
                  onClick={() => setShowItemAssignment(true)}
                  className="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-3 rounded-lg font-medium transition-colors shadow-md hover:shadow-lg"
                >
                  Assign Categories
                </button>
              </div>
            </div>
            
            {/* Quick preview of some unassigned items */}
            <div className="border-t border-yellow-300 dark:border-yellow-700 pt-4">
              <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-2 font-medium">
                Sample unassigned items:
              </p>
              <div className="flex flex-wrap gap-2">
                {unassignedItems.slice(0, 5).map((item) => (
                  <span key={item.id} className="text-xs bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded-full">
                    {item.name}
                  </span>
                ))}
                {unassignedItems.length > 5 && (
                  <span className="text-xs bg-yellow-300 dark:bg-yellow-700 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded-full font-medium">
                    +{unassignedItems.length - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {categories.length === 0 && !loading && (
        <div className="text-center py-12">
          <div className="text-gray-400 dark:text-gray-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No categories found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Add some inventory items to see categories here
          </p>
        </div>
      )}

      {/* Edit Category Modal */}
      {editingCategory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              Edit Category
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Category Name
                </label>
                <input
                  type="text"
                  value={editingCategory.name}
                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                           dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description
                </label>
                <input
                  type="text"
                  value={editingCategory.description}
                  onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                           dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpdateCategory(editingCategory)}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => setEditingCategory(null)}
                  className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Item Assignment Modal */}
      {showItemAssignment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Assign Items to Categories
              </h3>
              <button
                onClick={() => setShowItemAssignment(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Enhanced Search Bar */}
            <div className="mb-6">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="Search items by name, SKU, description, brand, or location..."
                  value={assignmentSearchTerm}
                  onChange={(e) => setAssignmentSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              {assignmentSearchTerm && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Showing {filteredUnassignedItems.length} of {unassignedItems.length} unassigned items
                </p>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Unassigned Items */}
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white mb-3">
                    Unassigned Items ({filteredUnassignedItems.length}{assignmentSearchTerm ? ` of ${unassignedItems.length}` : ''})
                  </h4>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredUnassignedItems.map((item) => (
                      <div key={item.id} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 dark:text-white text-sm">
                              {item.description || item.name}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              SKU: {item.sku}
                            </p>
                          </div>
                          <select
                            onChange={(e) => handleAssignItemToCategory(item, e.target.value)}
                            className="text-xs bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded px-2 py-1"
                            defaultValue=""
                          >
                            <option value="">Select Category</option>
                            {categories.map((cat) => (
                              <option key={cat.id} value={cat.name}>
                                {cat.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                    {filteredUnassignedItems.length === 0 && (
                      <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                        {assignmentSearchTerm 
                          ? `No unassigned items found matching "${assignmentSearchTerm}"`
                          : 'All items are assigned to categories'
                        }
                      </p>
                    )}
                  </div>
                </div>

                {/* Categories Overview */}
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white mb-3">
                    Categories ({categories.length})
                  </h4>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {categories.map((category) => (
                      <div key={category.id} className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-medium text-indigo-900 dark:text-indigo-100 text-sm">
                              {category.name}
                            </p>
                            <p className="text-xs text-indigo-700 dark:text-indigo-300">
                              {category.itemCount} items
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setShowItemAssignment(false);
                              handleViewCategory(category);
                            }}
                            className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 text-xs underline"
                          >
                            View Items
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoriesView;
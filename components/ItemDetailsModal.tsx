import React, { useState, useEffect } from 'react';
import type { InventoryItem } from '../types';
import { useAppContext } from '../context/AppContext';
import ConfirmationModal from './ConfirmationModal';

interface ItemDetailsModalProps {
  item: Omit<InventoryItem, 'id'> | InventoryItem | null;
  onClose: () => void;
  onSave: (item: Omit<InventoryItem, 'id'> | InventoryItem) => Promise<void>;
  onDelete?: (itemId: string) => Promise<void>;
}

const ItemDetailsModal: React.FC<ItemDetailsModalProps> = ({ item, onClose, onSave, onDelete }) => {
  const { state } = useAppContext();
  const { settings, currentOrganization, categories } = state;
  const [formData, setFormData] = useState<Omit<InventoryItem, 'id'> | InventoryItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  useEffect(() => {
    setFormData(item ? { ...item } : {
      name: '',
      sku: '',
      category: '',
      stock: 0,
      threshold: settings.lowStockThreshold,
      description: '',
      supplier: '',
      organizationId: currentOrganization.id,
    });
  }, [item, settings.lowStockThreshold, currentOrganization.id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    // FIX BUG-INV-008: Validate negative numbers for numeric fields
    if (type === 'number') {
      const numValue = parseFloat(value);
      // Prevent negative values for stock, threshold, cost, price
      if (['stock', 'threshold', 'cost', 'price'].includes(name) && numValue < 0) {
        return; // Don't update state with negative values
      }
      setFormData(prev => prev ? { ...prev, [name]: isNaN(numValue) ? 0 : numValue } : null);
    } else {
      setFormData(prev => prev ? { ...prev, [name]: value } : null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // FIX BUG-INV-002: Prevent double submission
    if (isSaving) return;
    if (formData) {
        setIsSaving(true);
        try {
            await onSave(formData);
        } finally {
            setIsSaving(false);
        }
    }
  };
  
  const handleDeleteClick = () => {
    if (isEditMode && onDelete) {
        setIsConfirmOpen(true);
    }
  };
  
  const handleConfirmDelete = async () => {
      if(isEditMode && onDelete) {
          setIsSaving(true);
          await onDelete(item.id);
          setIsSaving(false);
          setIsConfirmOpen(false);
      }
  }

  const isEditMode = item && 'id' in item;

  if (!formData) return null;

  return (
    <>
        <div className="fixed inset-0 bg-black bg-opacity-75 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300" onClick={onClose}>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-8 w-full max-w-2xl relative shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">{isEditMode ? 'Edit Item' : 'Add New Item'}</h2>
            <form onSubmit={handleSave}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-4">
                <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Item Name</label>
                <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                </div>
                <div>
                <label htmlFor="sku" className="block text-sm font-medium text-gray-500 dark:text-gray-400">SKU</label>
                <input type="text" name="sku" id="sku" value={formData.sku} onChange={handleChange} required className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                </div>
                <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Category</label>
                <input type="text" name="category" id="category" value={formData.category} onChange={handleChange} required list="categories-list" className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                <datalist id="categories-list">
                   {categories.map(cat => <option key={cat} value={cat} />)}
                </datalist>
                </div>
                <div>
                <label htmlFor="supplier" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Supplier</label>
                <input type="text" name="supplier" id="supplier" value={formData.supplier || ''} onChange={handleChange} className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                </div>
                <div>
                <label htmlFor="cost" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Cost Price (ZAR)</label>
                <input type="number" name="cost" id="cost" value={formData.cost || ''} onChange={handleChange} step="0.01" min="0" className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                </div>
                <div>
                <label htmlFor="price" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Selling Price (ZAR)</label>
                <input type="number" name="price" id="price" value={formData.price || ''} onChange={handleChange} step="0.01" min="0" className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                </div>
                <div className="md:col-span-2">
                <label htmlFor="description" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Description</label>
                {/* FIX BUG-INV-010: Add max length to prevent extremely long text */}
                <textarea name="description" id="description" value={formData.description || ''} onChange={handleChange} rows={3} maxLength={500} className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                </div>
                <div>
                <label htmlFor="stock" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Stock Quantity</label>
                {/* FIX BUG-INV-011: Add step="1" to prevent decimal stock values */}
                <input type="number" name="stock" id="stock" value={formData.stock} onChange={handleChange} step="1" min="0" required className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                </div>
                <div>
                <label htmlFor="threshold" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Restock Threshold</label>
                {/* FIX BUG-INV-011: Add step="1" to prevent decimal threshold values */}
                <input type="number" name="threshold" id="threshold" value={formData.threshold} onChange={handleChange} step="1" min="0" required className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                </div>
            </div>
            <div className="mt-8 flex justify-end items-center gap-4">
                {isEditMode && onDelete && (
                <button type="button" onClick={handleDeleteClick} disabled={isSaving} className="px-4 py-2 text-sm font-medium text-red-600 hover:text-white hover:bg-red-600 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-offset-gray-800 transition-colors mr-auto disabled:opacity-50">
                    Delete Item
                </button>
                )}
                <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white font-semibold rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
                Cancel
                </button>
                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:bg-indigo-800 disabled:cursor-wait transition-colors">
                {isSaving ? 'Saving...' : (isEditMode ? 'Save Changes' : 'Add Item')}
                </button>
            </div>
            </form>
            <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
        </div>
        {isEditMode && (
            <ConfirmationModal
                isOpen={isConfirmOpen}
                onClose={() => setIsConfirmOpen(false)}
                onConfirm={handleConfirmDelete}
                title="Confirm Deletion"
                message={`Are you sure you want to delete the item "${item.description || item.name}"? This action cannot be undone.`}
                confirmText="Delete"
                isConfirming={isSaving}
            />
        )}
    </>
  );
};

export default ItemDetailsModal;
import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';
import { importFromGoogleSheets, previewGoogleSheets, ColumnMapping } from '../services/apiService';

interface GoogleSheetsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const GoogleSheetsImportModal: React.FC<GoogleSheetsImportModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { state } = useAppContext();
  const { currentOrganization } = state;
  const addToast = useToast();
  
  const [sheetUrl, setSheetUrl] = useState('');
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    name: '',
    sku: '',
    costPrice: '',
    sellingPrice: '',
    quantity: '',
    category: '',
    supplier: '',
    description: '',
    unit: ''
  });
  const [isImporting, setIsImporting] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [previewData, setPreviewData] = useState<{headers: string[], sampleData: any[], suggestedMapping: ColumnMapping} | null>(null);
  const [useAutoMapping, setUseAutoMapping] = useState(false);

  const handlePreview = async () => {
    if (!sheetUrl.trim()) {
      addToast({ message: 'Please enter a Google Sheets URL', type: 'error' });
      return;
    }

    setIsPreview(true);
    
    try {
      const preview = await previewGoogleSheets(sheetUrl);
      setPreviewData(preview);
      setColumnMapping(preview.suggestedMapping);
      addToast({ message: 'Preview loaded! Auto-matched columns based on header names.', type: 'success' });
    } catch (error) {
      console.error('Preview error:', error);
      addToast({ 
        message: error instanceof Error ? error.message : 'Failed to preview Google Sheets', 
        type: 'error' 
      });
    } finally {
      setIsPreview(false);
    }
  };

  const handleImport = async () => {
    if (!sheetUrl.trim()) {
      addToast({ message: 'Please enter a Google Sheets URL', type: 'error' });
      return;
    }

    const mappingToUse = useAutoMapping ? null : columnMapping;
    
    if (!useAutoMapping && (!columnMapping.name || !columnMapping.sku || !columnMapping.quantity)) {
      addToast({ message: 'Name, SKU, and Quantity columns are required when not using auto-matching', type: 'error' });
      return;
    }

    setIsImporting(true);
    
    try {
      const importedItems = await importFromGoogleSheets(sheetUrl, mappingToUse, currentOrganization.id);
      
      // Check for duplicates and show appropriate message
      const duplicatesOverwritten = (importedItems as any)._duplicatesOverwritten || 0;
      const duplicateItems = (importedItems as any)._duplicateItems || [];
      
      if (duplicatesOverwritten > 0) {
        const duplicateList = duplicateItems.slice(0, 3).join(', ');
        const moreText = duplicatesOverwritten > 3 ? ` and ${duplicatesOverwritten - 3} more` : '';
        addToast({ 
          message: `Imported ${importedItems.length} items from Google Sheets. Overwrote ${duplicatesOverwritten} duplicate(s): ${duplicateList}${moreText}`, 
          type: 'warning' 
        });
      } else {
        addToast({ 
          message: `Successfully imported ${importedItems.length} new items from Google Sheets`, 
          type: 'success' 
        });
      }
      
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Import error:', error);
      addToast({ 
        message: error instanceof Error ? error.message : 'Failed to import from Google Sheets', 
        type: 'error' 
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setSheetUrl('');
    setColumnMapping({
      name: '',
      sku: '',
      costPrice: '',
      sellingPrice: '',
      quantity: '',
      category: '',
      supplier: '',
      description: '',
      unit: ''
    });
    setPreviewData(null);
    setUseAutoMapping(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4" style={{backdropFilter: 'blur(4px)'}}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Import from Google Sheets
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Import your inventory from a Google Sheets document. Make sure your sheet is shared publicly or with 'Anyone with the link can view' permission.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Google Sheets URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Google Sheets URL *
            </label>
            <input
              type="url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              disabled={isImporting}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Make sure the sheet is publicly accessible or shared with 'Anyone with the link can view'
            </p>
            <div className="flex space-x-2 mt-2">
              <button
                onClick={handlePreview}
                disabled={isPreview || !sheetUrl.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {isPreview && (
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                )}
                <span>{isPreview ? 'Loading...' : 'Preview & Auto-Match'}</span>
              </button>
            </div>
          </div>

          {/* Auto-matching toggle */}
          {previewData && (
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="useAutoMapping"
                  checked={useAutoMapping}
                  onChange={(e) => setUseAutoMapping(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="useAutoMapping" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Use automatic column matching (skip manual mapping)
                </label>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Auto-matched: {previewData.suggestedMapping.name && `Name→"${previewData.suggestedMapping.name}"`}
                {previewData.suggestedMapping.sku && `, SKU→"${previewData.suggestedMapping.sku}"`}
                {previewData.suggestedMapping.quantity && `, Qty→"${previewData.suggestedMapping.quantity}"`}
              </p>
            </div>
          )}

          {/* Column Mapping */}
          {!useAutoMapping && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Column Mapping
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Map your spreadsheet columns to the required fields. Enter the exact column header names from your sheet.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Required Fields */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Product Name Column *
                </label>
                <input
                  type="text"
                  value={columnMapping.name}
                  onChange={(e) => setColumnMapping(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Product Name"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={isImporting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  SKU Column *
                </label>
                <input
                  type="text"
                  value={columnMapping.sku}
                  onChange={(e) => setColumnMapping(prev => ({ ...prev, sku: e.target.value }))}
                  placeholder="e.g., SKU"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={isImporting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Cost Price Column
                </label>
                <input
                  type="text"
                  value={columnMapping.costPrice}
                  onChange={(e) => setColumnMapping(prev => ({ ...prev, costPrice: e.target.value }))}
                  placeholder="e.g., Cost Price"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={isImporting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Selling Price Column
                </label>
                <input
                  type="text"
                  value={columnMapping.sellingPrice}
                  onChange={(e) => setColumnMapping(prev => ({ ...prev, sellingPrice: e.target.value }))}
                  placeholder="e.g., Selling Price"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={isImporting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Quantity Column *
                </label>
                <input
                  type="text"
                  value={columnMapping.quantity}
                  onChange={(e) => setColumnMapping(prev => ({ ...prev, quantity: e.target.value }))}
                  placeholder="e.g., Quantity"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={isImporting}
                />
              </div>

              {/* Optional Fields */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Category Column
                </label>
                <input
                  type="text"
                  value={columnMapping.category}
                  onChange={(e) => setColumnMapping(prev => ({ ...prev, category: e.target.value }))}
                  placeholder="e.g., Category"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={isImporting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Supplier Column
                </label>
                <input
                  type="text"
                  value={columnMapping.supplier}
                  onChange={(e) => setColumnMapping(prev => ({ ...prev, supplier: e.target.value }))}
                  placeholder="e.g., Supplier"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={isImporting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Unit Column
                </label>
                <input
                  type="text"
                  value={columnMapping.unit}
                  onChange={(e) => setColumnMapping(prev => ({ ...prev, unit: e.target.value }))}
                  placeholder="e.g., Unit"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={isImporting}
                />
              </div>
            </div>
          </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-between">
          <button
            onClick={handleReset}
            disabled={isImporting}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
          >
            Reset
          </button>

          <div className="flex space-x-4">
            <button
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={isImporting || !sheetUrl.trim() || (!useAutoMapping && (!columnMapping.name || !columnMapping.sku || !columnMapping.quantity))}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {isImporting && (
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
              )}
              <span>{isImporting ? 'Importing...' : 'Import'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoogleSheetsImportModal;
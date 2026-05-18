import React, { useState, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';
import { importFromSpreadsheet, previewSpreadsheet, ColumnMapping } from '../services/apiService';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ExcelImportModal: React.FC<ExcelImportModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { state } = useAppContext();
  const { currentOrganization } = state;
  const addToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const fileName = file.name.toLowerCase();
      const isCsv = file.type === 'text/csv' || fileName.endsWith('.csv');
      const isExcel = file.type === 'application/vnd.ms-excel' || 
                      fileName.endsWith('.xlsx') || 
                      fileName.endsWith('.xls');
      
      if (!isCsv && !isExcel) {
        addToast({ message: 'Please select a CSV or Excel file', type: 'error' });
        return;
      }
      
      if (isExcel) {
        addToast({ 
          message: 'Excel files require conversion to CSV format for now. Consider using Google Sheets import for Excel files.', 
          type: 'warning' 
        });
      }
      
      setSelectedFile(file);
    }
  };

  const handlePreview = async () => {
    if (!selectedFile) {
      addToast({ message: 'Please select a file to preview', type: 'error' });
      return;
    }

    setIsPreview(true);
    
    try {
      const preview = await previewSpreadsheet(selectedFile);
      setPreviewData(preview);
      setColumnMapping(preview.suggestedMapping);
      addToast({ message: 'Preview loaded! Auto-matched columns based on header names.', type: 'success' });
    } catch (error) {
      console.error('Preview error:', error);
      addToast({ 
        message: error instanceof Error ? error.message : 'Failed to preview spreadsheet', 
        type: 'error' 
      });
    } finally {
      setIsPreview(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      addToast({ message: 'Please select a file to import', type: 'error' });
      return;
    }

    const mappingToUse = useAutoMapping ? null : columnMapping;
    
    if (!useAutoMapping && (!columnMapping.name || !columnMapping.sku || !columnMapping.quantity)) {
      addToast({ message: 'Name, SKU, and Quantity columns are required when not using auto-matching', type: 'error' });
      return;
    }

    setIsImporting(true);
    
    try {
      const importedItems = await importFromSpreadsheet(selectedFile, mappingToUse, currentOrganization.id);
      
      // Check for duplicates and show appropriate message
      const duplicatesOverwritten = (importedItems as any)._duplicatesOverwritten || 0;
      const duplicateItems = (importedItems as any)._duplicateItems || [];
      
      if (duplicatesOverwritten > 0) {
        const duplicateList = duplicateItems.slice(0, 3).join(', ');
        const moreText = duplicatesOverwritten > 3 ? ` and ${duplicatesOverwritten - 3} more` : '';
        addToast({ 
          message: `Imported ${importedItems.length} items from ${selectedFile.name}. Overwrote ${duplicatesOverwritten} duplicate(s): ${duplicateList}${moreText}`, 
          type: 'warning' 
        });
      } else {
        addToast({ 
          message: `Successfully imported ${importedItems.length} new items from ${selectedFile.name}`, 
          type: 'success' 
        });
      }
      
      // Call onSuccess if it's a function
      if (typeof onSuccess === 'function') {
        onSuccess();
      }
      onClose();
    } catch (error) {
      console.error('Import error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to import from spreadsheet';
      
      // Format multi-line error messages for better display
      const formattedError = errorMessage.includes('\\n') 
        ? errorMessage.replace(/\\n/g, '\n')
        : errorMessage;
      
      addToast({ 
        message: formattedError, 
        type: 'error' 
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
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
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setPreviewData(null);
    setUseAutoMapping(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4" style={{backdropFilter: 'blur(4px)'}}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Import from Spreadsheet
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Upload a CSV file and map your columns to import your inventory data.
          </p>
          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>💡 Tip:</strong> For Excel files (.xlsx, .xls), save them as CSV format first, or use our Google Sheets import option instead.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select File *
            </label>
            
            {!selectedFile ? (
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
                <div className="space-y-4">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImporting}
                      className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium disabled:opacity-50"
                    >
                      Choose file
                    </button>
                    <span className="text-gray-500 dark:text-gray-400"> or drag and drop</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    CSV files recommended. Excel files need to be converted to CSV first.
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={isImporting}
                />
              </div>
            ) : (
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 flex items-center justify-between bg-gray-50 dark:bg-gray-700">
                <div className="flex items-center space-x-3">
                  <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedFile.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button
                  onClick={removeFile}
                  disabled={isImporting}
                  className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            
            {/* Preview Button */}
            {selectedFile && (
              <div className="flex space-x-2 mt-2">
                <button
                  onClick={handlePreview}
                  disabled={isPreview}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isPreview && (
                    <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                  )}
                  <span>{isPreview ? 'Loading...' : 'Preview & Auto-Match'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Auto-matching toggle */}
          {previewData && (
            <>
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

              {/* Detected Columns Display */}
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                  📋 Detected Columns ({previewData.headers.length} total)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {previewData.headers.map((header, idx) => {
                    const letter = String.fromCharCode(65 + idx);
                    const sample = previewData.sampleData[0]?.[header] || '';
                    return (
                      <div key={idx} className="bg-white dark:bg-gray-800 p-2 rounded border border-blue-200 dark:border-blue-700">
                        <div className="font-mono text-blue-700 dark:text-blue-300">
                          {letter} ({idx})
                        </div>
                        <div className="text-gray-700 dark:text-gray-300 font-semibold truncate" title={header}>
                          "{header}"
                        </div>
                        <div className="text-gray-500 dark:text-gray-400 truncate" title={sample}>
                          → {sample}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  💡 Use the letter (A, B, C...), number (0, 1, 2...), or exact header name when mapping columns below.
                </p>
              </div>
            </>
          )}

          {/* Column Mapping */}
          {selectedFile && !useAutoMapping && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Column Mapping
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Map your spreadsheet columns using column letters (A, B, C...) or numbers (0, 1, 2...) or exact column header names.
              </p>
              <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-4">
                💡 Example: Use "A" for first column, "B" for second, or "0" for first, "1" for second, or the exact header name like "Product Name"
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
                    placeholder="e.g., A or 0 or Product Name"
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
                    placeholder="e.g., B or 1 or SKU"
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
                    placeholder="e.g., C or 2 or Cost Price"
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
                    placeholder="e.g., D or 3 or Selling Price"
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
                    placeholder="e.g., E or 4 or Quantity"
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
                    placeholder="e.g., F or 5 or Category"
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
                    placeholder="e.g., G or 6 or Supplier"
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
                    placeholder="e.g., H or 7 or Unit"
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
              disabled={isImporting || !selectedFile || (!useAutoMapping && (!columnMapping.name || !columnMapping.sku || !columnMapping.quantity))}
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

export default ExcelImportModal;
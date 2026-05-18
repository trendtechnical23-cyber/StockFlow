import React, { useState, useMemo, useEffect, useCallback } from 'react';
import InventoryTable from '../components/InventoryTable';
import { useAppContext } from '../context/AppContext';
import ItemDetailsModal from '../components/ItemDetailsModal';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { InventoryItem } from '../types';
import { useToast } from '../hooks/useToast';
import { getZohoItems, importFromZoho, syncInvoiceUsage, importFromPos } from '../services/apiService';
import { PosService } from '../services/posService';
import * as XLSX from 'xlsx';

const PlusIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>;
const BarcodeIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18M6 3v18M12 3v18M18 3v18"/></svg>;
const ChevronLeftIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6"></polyline></svg>;
const ChevronRightIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9,18 15,12 9,6"></polyline></svg>;
const RefreshIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>;


const InventoryView: React.FC = () => {
    const { state, selectItem, handleAddItem } = useAppContext();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [quickAddItem, setQuickAddItem] = useState({ name: '', sku: '', stock: '0', category: '' });
    const [currentPage, setCurrentPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [itemsPerPage, setItemsPerPage] = useState(() => {
        const saved = localStorage.getItem('stockflow_itemsPerPage');
        return saved ? parseInt(saved, 10) : 100;
    });
    const addToast = useToast();
    
    const AUTO_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds
    
    // Determine active integration
    const zohoConnected = state.currentOrganization?.integrations?.zoho?.status === 'connected';
    const posConnected = state.currentOrganization?.integrations?.pos?.status === 'connected';
    const activeIntegrationLabel = zohoConnected ? 'Zoho Books' : posConnected ? state.currentOrganization?.integrations?.pos?.provider || 'POS' : null;

    // Refresh from Zoho Books
    const handleRefreshFromZoho = useCallback(async (isAuto = false) => {
        setIsRefreshing(true);
        if (!isAuto) {
            addToast({ message: 'Updating inventory from Zoho Books...', type: 'info' });
        }
        
        try {
            // Step 1: Fetch and import items (quantities and prices)
            const zohoItems = await getZohoItems(state.currentOrganization.id);
            const importedItems = await importFromZoho(zohoItems, state.currentOrganization.id);
            
            // Step 2: Sync invoice usage (last sold dates)
            console.log('🧾 Syncing invoice usage data...');
            const usageResult = await syncInvoiceUsage(state.currentOrganization.id);
            console.log(`✅ Updated ${usageResult.itemsUpdated} items with invoice data from ${usageResult.invoicesProcessed} invoices`);
            
            setLastRefresh(new Date());
            
            const duplicatesOverwritten = (importedItems as any)._duplicatesOverwritten || 0;
            const duplicateItems = (importedItems as any)._duplicateItems || [];
            
            if (duplicatesOverwritten > 0) {
                const duplicateList = duplicateItems.slice(0, 3).join(', ');
                const moreText = duplicatesOverwritten > 3 ? ` and ${duplicatesOverwritten - 3} more` : '';
                addToast({ 
                    message: `Updated ${importedItems.length} items from Zoho. Synced ${usageResult.itemsUpdated} with invoice data. Overwrote ${duplicatesOverwritten} duplicate(s): ${duplicateList}${moreText}`, 
                    type: 'warning' 
                });
            } else {
                addToast({ 
                    message: `Successfully imported ${importedItems.length} items and synced ${usageResult.itemsUpdated} with invoice usage data`, 
                    type: 'success' 
                });
            }
            
            setTimeout(() => window.location.reload(), 1500);
            
        } catch (error: any) {
            console.error('Failed to refresh from Zoho:', error);
            if (!isAuto) {
                addToast({ message: error.message || 'Failed to refresh from Zoho Books', type: 'error' });
            }
        } finally {
            setIsRefreshing(false);
        }
    }, [state.currentOrganization, addToast]);

    // Refresh from POS system
    const handleRefreshFromPos = useCallback(async (isAuto = false) => {
        setIsRefreshing(true);
        if (!isAuto) {
            addToast({ message: 'Updating inventory from POS system...', type: 'info' });
        }
        try {
            const data = await PosService.getItems(state.currentOrganization.id);
            const importedItems = await importFromPos(data.items, state.currentOrganization.id);
            setLastRefresh(new Date());
            const dupsOverwritten = (importedItems as any)._duplicatesOverwritten || 0;
            if (dupsOverwritten > 0) {
                addToast({ message: `Updated ${importedItems.length} items from POS. Overwrote ${dupsOverwritten} duplicate(s).`, type: 'warning' });
            } else {
                addToast({ message: `Successfully imported ${importedItems.length} items from POS`, type: 'success' });
            }
            setTimeout(() => window.location.reload(), 1500);
        } catch (error: any) {
            console.error('Failed to refresh from POS:', error);
            if (!isAuto) {
                addToast({ message: error.message || 'Failed to refresh from POS', type: 'error' });
            }
        } finally {
            setIsRefreshing(false);
        }
    }, [state.currentOrganization, addToast]);

    // Smart refresh — delegates to whichever integration is active
    const handleRefreshFromIntegration = useCallback(async (isAuto = false) => {
        if (zohoConnected) {
            return handleRefreshFromZoho(isAuto);
        }
        if (posConnected) {
            return handleRefreshFromPos(isAuto);
        }
        if (!isAuto) {
            addToast({ message: 'No integration connected. Go to Integrations to connect Zoho Books or a POS system.', type: 'info' });
        }
    }, [zohoConnected, posConnected, handleRefreshFromZoho, handleRefreshFromPos, addToast]);
    
    // Reset to page 1 when items per page changes
    useEffect(() => {
        setCurrentPage(1);
    }, [itemsPerPage]);

    // Auto-refresh every 10 minutes from whichever integration is active
    useEffect(() => {
        const intervalId = setInterval(() => {
            handleRefreshFromIntegration(true); // true = auto refresh (silent)
        }, AUTO_REFRESH_INTERVAL);
        
        return () => clearInterval(intervalId);
    }, [handleRefreshFromIntegration]);
    
    // Filter and sort items - recently used items at top, older at bottom
    const filteredInventory = useMemo(() => {
        let filtered = state.inventory;
        
        if (searchTerm) {
            filtered = state.inventory.filter(item =>
                (item.name && item.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (item.description && item.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
                // FIX BUG-INV-006: Add null safety to SKU search
                (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase()))
            );
        }
        
        // Sort by lastUsed (most recent first), fallback to lastModified
        const sorted = [...filtered].sort((a, b) => {
            // Get timestamps - prefer lastUsed, fallback to lastModified
            const aTimeStr = a.lastUsed || a.lastModified || '';
            const bTimeStr = b.lastUsed || b.lastModified || '';
            
            // If either is missing, put items with timestamps first
            if (!aTimeStr) return 1;
            if (!bTimeStr) return -1;
            
            // Parse as dates and compare (newest first = descending)
            try {
                const aDate = new Date(aTimeStr).getTime();
                const bDate = new Date(bTimeStr).getTime();
                return bDate - aDate; // Descending - newest first
            } catch (error) {
                return 0; // If parsing fails, maintain order
            }
        });
        
        // Debug: Log first 3 items to verify sorting
        if (sorted.length > 0) {
            console.log('📊 Top 3 items after sorting:', sorted.slice(0, 3).map(item => ({
                name: item.name,
                lastUsed: item.lastUsed,
                lastModified: item.lastModified
            })));
        }
        
        return sorted;
    }, [state.inventory, searchTerm]);
    
    // Pagination calculations based on filtered items
    const totalItems = filteredInventory.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentItems = filteredInventory.slice(startIndex, endIndex);
    
    // Reset to page 1 when search changes
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);
    
    const paginationInfo = useMemo(() => ({
        current: currentPage,
        total: totalPages,
        itemsStart: startIndex + 1,
        itemsEnd: Math.min(endIndex, totalItems),
        totalItems
    }), [currentPage, totalPages, startIndex, endIndex, totalItems, itemsPerPage]);

    const handleItemClick = (item: InventoryItem) => {
        selectItem(item.id);
    };
    
    const handleScanSuccess = (decodedText: string) => {
        setSearchTerm(decodedText);
        setIsScannerOpen(false);
    };

    const handleSaveNewItem = async (itemData: Omit<InventoryItem, 'id'>) => {
        await handleAddItem(itemData as Omit<InventoryItem, 'id' | 'organizationId'>);
        setIsAddModalOpen(false);
    };


    const handleQuickAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!quickAddItem.name || !quickAddItem.sku) {
            addToast({ message: 'Name and SKU are required for Quick Add.', type: 'error' });
            return;
        }

        const newItemData = {
            name: quickAddItem.name,
            sku: quickAddItem.sku,
            stock: parseInt(quickAddItem.stock, 10) || 0,
            category: quickAddItem.category || state.settings.zohoSync?.defaultCategory || '',
            threshold: state.settings.lowStockThreshold,
            supplier: '',
            description: ''
        };

        await handleAddItem(newItemData);
        addToast({ message: `Quickly added ${newItemData.name}!`, type: 'success' });
        
        // Clear the form
        setQuickAddItem({ name: '', sku: '', stock: '0', category: '' });
    };

    const handleQuickAddInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setQuickAddItem(prev => ({
            ...prev,
            [name]: value
        }));
    };

    return (
        <div className="h-full flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            {/* Compact Header Section */}
            <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
                {/* Title and Actions - Single Row */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-200">Full Inventory</h1>
                        {lastRefresh && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Last updated: {lastRefresh.toLocaleTimeString()}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handleRefreshFromIntegration(false)}
                            disabled={isRefreshing || !activeIntegrationLabel}
                            title={!activeIntegrationLabel ? 'No integration connected — configure one in Integrations' : `Update from ${activeIntegrationLabel}`}
                            className={`px-3 py-2 rounded-md transition-colors flex items-center gap-2 text-sm font-medium ${
                                isRefreshing
                                    ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                                    : !activeIntegrationLabel
                                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                    : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                        >
                            <RefreshIcon />
                            {isRefreshing ? 'Updating...' : activeIntegrationLabel ? `Update from ${activeIntegrationLabel}` : 'No Integration'}
                        </button>
                        
                        <button 
                            onClick={() => setIsAddModalOpen(true)} 
                            className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors flex items-center gap-2 text-sm font-medium"
                        >
                            <PlusIcon />
                            Add Item
                        </button>

                        <button
                            onClick={() => {
                                try {
                                    const itemsToExport = filteredInventory || [];
                                    const rows = itemsToExport.map(it => {
                                        const fmt = (v: any) => {
                                            if (v && typeof v?.toDate === 'function') return v.toDate().toISOString();
                                            if (typeof v === 'number' && v > 1e12) return new Date(v).toISOString();
                                            return v ?? '';
                                        };
                                        return {
                                            Name: it.name ?? '',
                                            SKU: it.sku ?? '',
                                            Stock: it.stock ?? 0,
                                            Threshold: it.threshold ?? 0,
                                            Cost: it.cost ?? 0,
                                            Price: it.price ?? 0,
                                            Description: it.description ?? '',
                                            Unit: it.unit ?? '',
                                            'Created At': fmt((it as any).createdAt),
                                            'Updated At': fmt((it as any).updatedAt),
                                        };
                                    });

                                    const ws = XLSX.utils.json_to_sheet(rows);
                                    const wb = XLSX.utils.book_new();
                                    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
                                    const now = new Date();
                                    const padded = (n: number) => String(n).padStart(2, '0');
                                    const filename = `stockflow_items_${now.getFullYear()}${padded(now.getMonth()+1)}${padded(now.getDate())}_${padded(now.getHours())}${padded(now.getMinutes())}.xlsx`;
                                    XLSX.writeFile(wb, filename);
                                    addToast({ message: `Exported ${itemsToExport.length} items`, type: 'success' });
                                } catch (err: any) {
                                    addToast({ message: `Export failed: ${err?.message || err}`, type: 'error' });
                                }
                            }}
                            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-2 font-medium"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Export Current Items
                        </button>
                    </div>
                </div>
                
                {/* Search Bar */}
                <div className="mb-6">
                    <div className="flex items-center max-w-md">
                        <input
                            type="text"
                            placeholder="Search by name, description, or SKU..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="flex-grow px-4 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        <button 
                            onClick={() => setIsScannerOpen(true)} 
                            className="p-2 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-r-lg border border-l-0 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                            title="Scan Barcode"
                        >
                            <BarcodeIcon />
                        </button>
                    </div>
                    {searchTerm && (
                        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                            Found {totalItems} item{totalItems !== 1 ? 's' : ''}
                        </div>
                    )}
                </div>
                
                {/* Quick Add Form */}
                <form onSubmit={handleQuickAdd} className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                        <div>
                            <label htmlFor="quick-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Item Name
                            </label>
                            <input
                                id="quick-name"
                                type="text"
                                name="name"
                                placeholder="e.g., Wireless Mouse"
                                value={quickAddItem.name}
                                onChange={handleQuickAddInputChange}
                                required
                                className="w-full px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label htmlFor="quick-sku" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                SKU
                            </label>
                            <input
                                id="quick-sku"
                                type="text"
                                name="sku"
                                placeholder="e.g., LOGI-M510"
                                value={quickAddItem.sku}
                                onChange={handleQuickAddInputChange}
                                required
                                className="w-full px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label htmlFor="quick-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Category
                            </label>
                            <input
                                id="quick-category"
                                type="text"
                                name="category"
                                placeholder="e.g., Office Supplies"
                                value={quickAddItem.category}
                                onChange={handleQuickAddInputChange}
                                list="categories-list"
                                className="w-full px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label htmlFor="quick-stock" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Stock
                            </label>
                            <input
                                id="quick-stock"
                                type="number"
                                name="stock"
                                value={quickAddItem.stock}
                                onChange={handleQuickAddInputChange}
                                className="w-full px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <button 
                                type="submit" 
                                className="w-full px-4 py-2 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 transition-colors"
                            >
                                Quick Add
                            </button>
                        </div>
                    </div>
                </form>
                
                {/* Items Count and Pagination Info */}
                <div className="mt-4 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center space-x-4">
                        <div>
                            Showing <span className="font-medium text-gray-900 dark:text-gray-100">{paginationInfo.itemsStart}</span> to{' '}
                            <span className="font-medium text-gray-900 dark:text-gray-100">{paginationInfo.itemsEnd}</span> of{' '}
                            <span className="font-medium text-gray-900 dark:text-gray-100">{paginationInfo.totalItems}</span> {searchTerm ? 'search results' : 'items'}
                        </div>
                        <div className="flex items-center space-x-2">
                            <span>Items per page:</span>
                            <select
                                value={itemsPerPage}
                                onChange={(e) => {
                                    const newItemsPerPage = parseInt(e.target.value);
                                    setItemsPerPage(newItemsPerPage);
                                    localStorage.setItem('stockflow_itemsPerPage', newItemsPerPage.toString());
                                    setCurrentPage(1); // Reset to first page when changing items per page
                                }}
                                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            >
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                                <option value={200}>200</option>
                                <option value={500}>500</option>
                            </select>
                        </div>
                    </div>
                    
                    {/* Pagination Numbers */}
                    {totalPages > 1 && (
                        <nav className="flex items-center space-x-1">
                            <button
                                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                disabled={currentPage === 1}
                                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ChevronLeftIcon />
                            </button>
                            
                            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                                let pageNum;
                                if (totalPages <= 7) {
                                    pageNum = i + 1;
                                } else if (currentPage <= 4) {
                                    pageNum = i + 1;
                                } else if (currentPage >= totalPages - 3) {
                                    pageNum = totalPages - 6 + i;
                                } else {
                                    pageNum = currentPage - 3 + i;
                                }
                                
                                return (
                                    <button
                                        key={pageNum}
                                        onClick={() => setCurrentPage(pageNum)}
                                        className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                                            currentPage === pageNum
                                                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
                                                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                                        }`}
                                    >
                                        {pageNum}
                                    </button>
                                );
                            })}
                            
                            <button
                                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                                disabled={currentPage === totalPages}
                                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ChevronRightIcon />
                            </button>
                        </nav>
                    )}
                </div>
            </div>

            {/* Scrollable Items Table */}
            <div className="flex-1 overflow-hidden">
                <div className="h-full overflow-y-auto">
                    <InventoryTable
                        inventory={currentItems}
                        onItemClick={handleItemClick}
                    />
                </div>
            </div>

            {/* Modals */}
            {isAddModalOpen && 
                <ItemDetailsModal 
                    item={null} 
                    onClose={() => setIsAddModalOpen(false)} 
                    onSave={handleSaveNewItem} 
                />
            }
            {isScannerOpen && 
                <BarcodeScannerModal 
                    onClose={() => setIsScannerOpen(false)} 
                    onScanSuccess={handleScanSuccess} 
                />
            }
            <datalist id="categories-list">
                {state.categories.map(cat => <option key={cat} value={cat} />)}
            </datalist>
        </div>
    );
};

export default InventoryView;
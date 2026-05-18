// ============================================================================
// PURCHASE ORDERS PAGE
// Main page for managing purchase orders
// ============================================================================

import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  PurchaseOrder,
  POStatus,
  POStatusLabels,
  POStatusColors,
  PaymentStatus,
  PaymentStatusLabels,
  PaymentTerms,
  ApprovalStatus
} from '../types/purchaseOrders';
import {
  listPurchaseOrders,
  getPOStatistics,
  subscribeToPurchaseOrders,
  deletePurchaseOrder,
  createPurchaseOrder
} from '../services/purchaseOrderService';
import { listSuppliers, createSupplier } from '../services/supplierService';
import { ZohoService } from '../services/zohoService';
import { Timestamp } from 'firebase/firestore';
import CreatePurchaseOrderModal from '../components/CreatePurchaseOrderModal';

const PurchaseOrdersPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentOrganization, currentUser } = state;
  
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all');
  const [importingFromZoho, setImportingFromZoho] = useState(false);
  const [zohoImportProgress, setZohoImportProgress] = useState('');
  
  // Statistics
  const [stats, setStats] = useState({
    totalPOs: 0,
    totalValue: 0,
    pendingApprovals: 0,
    activeOrders: 0,
    receivedThisMonth: 0
  });

  // Load POs
  useEffect(() => {
    if (!currentOrganization?.id) return;

    setLoading(true);
    
    // Subscribe to real-time updates
    const unsubscribe = subscribeToPurchaseOrders(
      currentOrganization.id,
      (orders) => {
        setPurchaseOrders(orders);
        setFilteredOrders(orders);
        setLoading(false);
      },
      {
        orderByField: 'createdAt',
        orderDirection: 'desc'
      }
    );

    // Load statistics
    loadStatistics();

    return () => unsubscribe();
  }, [currentOrganization?.id]);

  // Load statistics
  const loadStatistics = async () => {
    if (!currentOrganization?.id) return;
    
    try {
      const statistics = await getPOStatistics(currentOrganization.id);
      setStats(statistics);
    } catch (error) {
      console.error('Error loading statistics:', error);
    }
  };

  // Filter orders
  useEffect(() => {
    let filtered = [...purchaseOrders];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(po =>
        po.poNumber.toLowerCase().includes(term) ||
        po.supplierName.toLowerCase().includes(term) ||
        po.title?.toLowerCase().includes(term) ||
        po.referenceNumber?.toLowerCase().includes(term)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(po => po.status === statusFilter);
    }

    setFilteredOrders(filtered);
  }, [searchTerm, statusFilter, purchaseOrders]);

  // Format currency
  const formatCurrency = (amount: number, currency: string = 'ZAR') => {
    const symbol = currency === 'ZAR' ? 'R' : currency === 'USD' ? '$' : '€';
    return `${symbol} ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Format date
  const formatDate = (date: Date | Timestamp | undefined | null) => {
    if (!date) return '-';
    try {
      const d = date instanceof Timestamp ? date.toDate() : date;
      // Additional check to ensure d is a valid Date object
      if (!d || typeof d.toLocaleDateString !== 'function') return '-';
      return d.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (error) {
      console.warn('Error formatting date:', date, error);
      return '-';
    }
  };

  // Get status badge color
  const getStatusBadgeClass = (status: POStatus) => {
    const colorMap: Record<string, string> = {
      gray: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
      yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      cyan: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
      purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
      orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200'
    };
    
    const color = POStatusColors[status] || 'gray';
    return colorMap[color] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  };

  // Delete PO
  const handleDelete = async (poId: string) => {
    if (!currentOrganization?.id || !currentUser) return;
    
    if (!confirm('Are you sure you want to delete this purchase order?')) return;
    
    try {
      await deletePurchaseOrder(
        currentOrganization.id,
        poId,
        currentUser.id,
        currentUser.name || currentUser.email
      );
      alert('Purchase order deleted successfully');
    } catch (error) {
      console.error('Error deleting PO:', error);
      alert('Failed to delete purchase order');
    }
  };

  // Handle successful PO creation
  const handleCreateSuccess = () => {
    loadStatistics();
    alert('Purchase order created successfully!');
  };

  // Import purchase orders from Zoho
  const handleImportFromZoho = async () => {
    if (!currentOrganization?.id || !currentUser) return;

    try {
      setImportingFromZoho(true);
      setZohoImportProgress('Connecting to Zoho Books...');

      // Check if Zoho is connected
      const isConnected = await ZohoService.isConnected(currentOrganization.id);
      if (!isConnected) {
        alert('Zoho Books is not connected. Please connect Zoho Books first in Settings.');
        return;
      }

      setZohoImportProgress('Fetching purchase orders from Zoho...');
      const zohoPOs = await ZohoService.importPurchaseOrders(currentOrganization.id);

      if (!zohoPOs || zohoPOs.length === 0) {
        alert('No purchase orders found in Zoho Books.');
        return;
      }

      setZohoImportProgress(`Found ${zohoPOs.length} purchase orders. Processing...`);

      // Get existing suppliers
      const existingSuppliers = await listSuppliers(currentOrganization.id);

      let importedCount = 0;
      let skippedCount = 0;

      for (const zohoPO of zohoPOs) {
        try {
          // Find or create supplier
          let supplier = existingSuppliers.find(
            s => s.zohoVendorId === zohoPO.supplierInfo.zohoId || 
                 s.name.toLowerCase() === zohoPO.supplierInfo.name.toLowerCase()
          );

          if (!supplier) {
            setZohoImportProgress(`Creating supplier: ${zohoPO.supplierInfo.name}...`);
            const supplierId = await createSupplier(
              currentOrganization.id,
              {
                name: zohoPO.supplierInfo.name,
                zohoVendorId: zohoPO.supplierInfo.zohoId,
                primaryContact: {
                  name: zohoPO.supplierInfo.name,
                  email: zohoPO.supplierInfo.email || '',
                  phone: zohoPO.supplierInfo.phone || ''
                },
                defaultPaymentTerms: PaymentTerms.NET_30,
                isActive: true
              },
              currentUser.uid,
              currentUser.name || currentUser.email
            );
            // Reload suppliers to get the new one
            const updatedSuppliers = await listSuppliers(currentOrganization.id);
            supplier = updatedSuppliers.find(s => s.id === supplierId);
          }

          if (!supplier) {
            console.error('Failed to create/find supplier:', zohoPO.supplierInfo.name);
            skippedCount++;
            continue;
          }

          // Check if PO already exists (by Zoho ID)
          const existingPOs = purchaseOrders.filter(
            po => (po as any).zohoId === zohoPO.zohoId
          );
          
          if (existingPOs.length > 0) {
            console.log('Skipping duplicate PO:', zohoPO.zohoNumber);
            skippedCount++;
            continue;
          }

          setZohoImportProgress(`Importing PO: ${zohoPO.zohoNumber || zohoPO.referenceNumber}...`);

          // Create PO
          await createPurchaseOrder(
            currentOrganization.id,
            {
              ...zohoPO,
              supplierId: supplier.id,
              supplierName: supplier.name,
              supplierEmail: supplier.primaryContact.email,
              approvalStatus: 'APPROVED' as any, // Zoho POs come pre-approved
              paymentStatus: 'PENDING' as any,
              zohoId: zohoPO.zohoId,
              zohoPONumber: zohoPO.zohoNumber
            },
            currentUser.uid,
            currentUser.name || currentUser.email
          );

          importedCount++;
        } catch (error) {
          console.error('Error importing PO:', zohoPO.zohoNumber, error);
          skippedCount++;
        }
      }

      setZohoImportProgress('');
      alert(`Import complete!\n\nImported: ${importedCount} purchase orders\nSkipped: ${skippedCount} (duplicates or errors)`);
      loadStatistics();

    } catch (error) {
      console.error('Error importing from Zoho:', error);
      alert(`Failed to import from Zoho: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setImportingFromZoho(false);
      setZohoImportProgress('');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600 dark:text-gray-400">Loading purchase orders...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Purchase Orders</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Manage and track purchase orders</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleImportFromZoho}
            disabled={importingFromZoho}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {importingFromZoho ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Importing...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                <span>Import from Zoho</span>
              </>
            )}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            + Create Purchase Order
          </button>
        </div>
      </div>

      {/* Import Progress */}
      {zohoImportProgress && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-blue-900 dark:text-blue-200 font-medium">{zohoImportProgress}</span>
          </div>
        </div>
      )}

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-400">Total POs</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalPOs}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Value</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {formatCurrency(stats.totalValue)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-400">Pending Approval</div>
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.pendingApprovals}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-400">Active Orders</div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.activeOrders}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 dark:text-gray-400">Received This Month</div>
          <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">{stats.receivedThisMonth}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Search */}
          <div>
            <input
              type="text"
              placeholder="Search by PO number, supplier, title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as POStatus | 'all')}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="all">All Statuses</option>
              {Object.entries(POStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Purchase Orders List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No purchase orders</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Get started by creating a new purchase order.
            </p>
            <div className="mt-6">
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
              >
                + Create Purchase Order
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    PO Number
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Total Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Issue Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredOrders.map((po) => (
                  <tr key={po.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{po.poNumber}</div>
                      {po.source === 'zoho' && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">Zoho Sync</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">{po.supplierName}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{po.supplierEmail}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-white">{po.title || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(po.status)}`}
                      >
                        {POStatusLabels[po.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatCurrency(po.totalAmount, po.currency)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {PaymentStatusLabels[po.paymentStatus]}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(po.issueDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button
                        onClick={() => setSelectedPO(po)}
                        className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleDelete(po.id!)}
                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreatePurchaseOrderModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />

      {selectedPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Purchase Order Details</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">PO Number</div>
                  <div className="font-medium text-gray-900 dark:text-white">{selectedPO.poNumber}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Status</div>
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(selectedPO.status)}`}>
                    {POStatusLabels[selectedPO.status]}
                  </span>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Supplier</div>
                  <div className="font-medium text-gray-900 dark:text-white">{selectedPO.supplierName}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Total Amount</div>
                  <div className="font-medium text-green-600 dark:text-green-400">
                    {formatCurrency(selectedPO.totalAmount, selectedPO.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Issue Date</div>
                  <div className="font-medium text-gray-900 dark:text-white">{formatDate(selectedPO.issueDate)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Payment Terms</div>
                  <div className="font-medium text-gray-900 dark:text-white">{selectedPO.paymentTerms}</div>
                </div>
              </div>

              {selectedPO.lineItems && selectedPO.lineItems.length > 0 && (
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">Line Items</div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
                    <table className="min-w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Description</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Qty</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Price</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {selectedPO.lineItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">{item.description}</td>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">{item.quantityOrdered} {item.unit}</td>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">{formatCurrency(item.unitPrice, selectedPO.currency)}</td>
                            <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(item.total, selectedPO.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedPO(null)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
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

export default PurchaseOrdersPage;

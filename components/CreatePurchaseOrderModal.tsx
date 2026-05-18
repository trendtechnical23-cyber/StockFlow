// ============================================================================
// CREATE PURCHASE ORDER MODAL
// Comprehensive form for creating new purchase orders
// ============================================================================

import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { InventoryItem } from '../types';
import {
  PurchaseOrder,
  POStatus,
  PaymentTerms,
  PaymentStatus,
  PaymentTermsLabels,
  POLineItem,
  ApprovalStatus,
  SupportedCurrencies
} from '../types/purchaseOrders';
import { Supplier } from '../types/purchaseOrders';
import { createPurchaseOrder } from '../services/purchaseOrderService';
import { listSuppliers, createSupplier } from '../services/supplierService';
import { Timestamp } from 'firebase/firestore';

interface CreatePurchaseOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreatePurchaseOrderModal: React.FC<CreatePurchaseOrderModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { state } = useAppContext();
  const { currentOrganization, currentUser } = state;

  // Form state
  const [title, setTitle] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [currency, setCurrency] = useState<'ZAR' | 'USD' | 'EUR' | 'GBP'>('ZAR');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(PaymentTerms.NET_30);
  const [shippingCost, setShippingCost] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [notes, setNotes] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(false);
  
  // Custodial Tracking (SA Compliance)
  const [ownerType, setOwnerType] = useState<'own' | 'customer' | 'supplier' | 'thirdParty'>('own');
  const [ownerID, setOwnerID] = useState<string>(''); // Customer ID if custodial
  const [ownerName, setOwnerName] = useState<string>(''); // Customer name if custodial
  const [custodialNotes, setCustodialNotes] = useState<string>('');
  
  // Delivery address
  const [deliveryStreet, setDeliveryStreet] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryProvince, setDeliveryProvince] = useState('');
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('');
  const [deliveryCountry, setDeliveryCountry] = useState('South Africa');

  // Line items
  const [lineItems, setLineItems] = useState<POLineItem[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState<string[]>([]); // Search query per line item
  
  // Inventory (from AppContext)
  const inventory = state.inventory || [];
  
  // Suppliers
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  
  // New supplier form
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  
  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load suppliers
  useEffect(() => {
    if (!currentOrganization?.id) return;
    
    loadSuppliers();
  }, [currentOrganization?.id]);

  const loadSuppliers = async () => {
    if (!currentOrganization?.id) return;
    
    try {
      setLoadingSuppliers(true);
      const supplierList = await listSuppliers(currentOrganization.id);
      setSuppliers(supplierList);
    } catch (error) {
      console.error('Error loading suppliers:', error);
    } finally {
      setLoadingSuppliers(false);
    }
  };

  // Add line item
  const addLineItem = () => {
    const newItem: POLineItem = {
      lineNumber: lineItems.length + 1,
      sku: '',
      description: '',
      quantityOrdered: 1,
      quantityReceived: 0,
      unit: 'EA',
      unitPrice: 0,
      discountPercentage: 0,
      discountAmount: 0,
      subtotal: 0,
      vatRate: 15, // South Africa VAT rate
      vatAmount: 0,
      total: 0,
      status: 'pending' as any,
      isReceived: false,
      scannedQuantity: 0,
      ownerType: ownerType,
      threeWayMatchStatus: 'pending',
      // Custodial tracking (only include if not 'own')
      ...(ownerType !== 'own' && ownerID && { ownerID }),
      ...(ownerType !== 'own' && ownerName && { ownerName })
    } as POLineItem;
    setLineItems([...lineItems, newItem]);
    setProductSearchQuery([...productSearchQuery, '']);
  };

  // Select product from inventory
  const selectProduct = (index: number, productId: string) => {
    if (!productId) {
      // Clear product selection
      updateLineItem(index, 'productId', undefined);
      updateLineItem(index, 'sku', '');
      updateLineItem(index, 'description', '');
      updateLineItem(index, 'unitPrice', 0);
      return;
    }

    const product = inventory.find(item => item.id === productId);
    if (!product) return;

    const updated = [...lineItems];
    updated[index] = {
      ...updated[index],
      productId: product.id,
      sku: product.sku || '',
      description: product.name || product.description || '',
      unitPrice: product.cost || product.price || 0,
      unit: product.unit || 'EA'
    };

    // Recalculate totals
    const item = updated[index];
    const subtotalCalc = item.quantityOrdered * item.unitPrice;
    const discountAmount = subtotalCalc * (item.discountPercentage / 100);
    const afterDiscount = subtotalCalc - discountAmount;
    item.subtotal = subtotalCalc;
    item.discountAmount = discountAmount;
    item.vatAmount = afterDiscount * (item.vatRate / 100);
    item.total = afterDiscount + item.vatAmount;

    setLineItems(updated);
  };

  // Remove line item
  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
    setProductSearchQuery(productSearchQuery.filter((_, i) => i !== index));
  };

  // Filter products by search query
  const getFilteredProducts = (index: number) => {
    const query = productSearchQuery[index]?.toLowerCase() || '';
    if (!query) return inventory;
    return inventory.filter(product => 
      product.name?.toLowerCase().includes(query) ||
      product.sku?.toLowerCase().includes(query) ||
      product.description?.toLowerCase().includes(query)
    );
  };

  // Update line item
  const updateLineItem = (index: number, field: keyof POLineItem, value: any) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    
    // Recalculate totals
    const item = updated[index];
    const subtotalCalc = item.quantityOrdered * item.unitPrice;
    const discountAmount = subtotalCalc * (item.discountPercentage / 100);
    const afterDiscount = subtotalCalc - discountAmount;
    item.subtotal = subtotalCalc;
    item.discountAmount = discountAmount;
    item.vatAmount = afterDiscount * (item.vatRate / 100);
    item.total = afterDiscount + item.vatAmount;
    
    setLineItems(updated);
  };

  // Calculate financial summary
  const calculateSummary = () => {
    const subtotal = lineItems.reduce((sum, item) => {
      return sum + (item.quantityOrdered * item.unitPrice);
    }, 0);
    
    const totalDiscount = lineItems.reduce((sum, item) => {
      return sum + (item.quantityOrdered * item.unitPrice * (item.discountPercentage / 100));
    }, 0);
    
    const afterDiscount = subtotal - totalDiscount;
    
    const totalVAT = lineItems.reduce((sum, item) => sum + item.vatAmount, 0);
    
    const grandTotal = afterDiscount + totalVAT + shippingCost;
    
    return {
      subtotal,
      totalDiscount,
      totalVAT,
      shippingCost,
      grandTotal
    };
  };

  const summary = calculateSummary();

  // Create new supplier inline
  const handleCreateSupplier = async () => {
    if (!currentOrganization?.id || !currentUser) return;
    if (!newSupplierName || !newSupplierEmail) {
      setError('Supplier name and email are required');
      return;
    }

    try {
      const supplierId = await createSupplier(
        currentOrganization.id,
        {
          name: newSupplierName,
          primaryContact: {
            name: newSupplierName,
            email: newSupplierEmail,
            phone: newSupplierPhone
          },
          isActive: true
        },
        currentUser.id,
        currentUser.name || currentUser.email
      );
      
      // Reload suppliers
      await loadSuppliers();
      
      // Select the new supplier
      setSelectedSupplierId(supplierId);
      
      // Reset form
      setNewSupplierName('');
      setNewSupplierEmail('');
      setNewSupplierPhone('');
      setShowSupplierForm(false);
      setError('');
    } catch (error) {
      console.error('Error creating supplier:', error);
      setError('Failed to create supplier');
    }
  };

  // Helper function to remove undefined values (Firebase doesn't accept them)
  const removeUndefined = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(item => removeUndefined(item));
    }
    if (obj !== null && typeof obj === 'object') {
      return Object.entries(obj).reduce((acc, [key, value]) => {
        if (value !== undefined) {
          acc[key] = removeUndefined(value);
        }
        return acc;
      }, {} as any);
    }
    return obj;
  };

  // Submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentOrganization?.id || !currentUser) return;
    
    // Validation
    if (!title) {
      setError('Please enter a title');
      return;
    }
    if (!selectedSupplierId) {
      setError('Please select a supplier');
      return;
    }
    if (lineItems.length === 0) {
      setError('Please add at least one line item');
      return;
    }
    if (ownerType !== 'own' && !ownerName) {
      setError('Please enter the owner name for custodial items');
      return;
    }
    
    const supplier = suppliers.find(s => s.id === selectedSupplierId);
    if (!supplier) {
      setError('Selected supplier not found');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      
      const poData: Partial<PurchaseOrder> = {
        title,
        referenceNumber,
        currency,
        supplierId: supplier.id!,
        supplierName: supplier.name,
        supplierEmail: supplier.primaryContact.email,
        supplierPhone: supplier.primaryContact.phone,
        supplierAddress: supplier.address,
        issueDate: Timestamp.fromDate(new Date(issueDate)),
        expectedDeliveryDate: expectedDeliveryDate ? Timestamp.fromDate(new Date(expectedDeliveryDate)) : undefined,
        paymentTerms,
        paymentStatus: PaymentStatus.UNPAID,
        deliveryAddress: deliveryStreet ? {
          street: deliveryStreet,
          city: deliveryCity,
          province: deliveryProvince,
          postalCode: deliveryPostalCode,
          country: deliveryCountry
        } : undefined,
        lineItems,
        subtotal: summary.subtotal,
        discountAmount: summary.totalDiscount,
        vatAmount: summary.totalVAT,
        shippingCost: summary.shippingCost,
        totalAmount: summary.grandTotal,
        internalNotes: notes,
        approvalRequired,
        approvalStatus: approvalRequired ? ApprovalStatus.PENDING : ApprovalStatus.NOT_REQUIRED
      };

      // Remove undefined values (Firebase doesn't accept them)
      const cleanData = removeUndefined(poData);

      await createPurchaseOrder(
        currentOrganization.id,
        cleanData,
        currentUser.id,
        currentUser.name || currentUser.email
      );

      // Success
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error creating purchase order:', error);
      setError('Failed to create purchase order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    const symbol = currency === 'ZAR' ? 'R' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
    return `${symbol} ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Create Purchase Order</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
            </div>
          )}

          {/* Basic Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Basic Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., Office Supplies Q1 2026"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reference Number
                </label>
                <input
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="Optional reference"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Currency <span className="text-red-500">*</span>
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  {SupportedCurrencies.map(curr => (
                    <option key={curr.code} value={curr.code}>{curr.code} - {curr.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Issue Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Expected Delivery Date
                </label>
                <input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Payment Terms <span className="text-red-500">*</span>
                </label>
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value as PaymentTerms)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  {Object.entries(PaymentTermsLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Ownership / Custodial Tracking (SA Compliance) */}
          <div className="border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4">
            <div className="flex items-start gap-2 mb-3">
              <svg className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  Ownership Tracking (SARS Compliance)
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Who owns these items? Items held for others must be tracked separately to avoid balance sheet fraud.
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Owner Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={ownerType}
                  onChange={(e) => {
                    const newType = e.target.value as 'own' | 'customer' | 'supplier' | 'thirdParty';
                    setOwnerType(newType);
                    // Clear owner details if switching to 'own'
                    if (newType === 'own') {
                      setOwnerID('');
                      setOwnerName('');
                      setCustodialNotes('');
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500"
                >
                  <option value="own">🏢 Our Company (On Balance Sheet)</option>
                  <option value="customer">👤 Customer (Off Balance Sheet)</option>
                  <option value="supplier">📦 Supplier (Consignment)</option>
                  <option value="thirdParty">🤝 Third Party (Custodial)</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {ownerType === 'own' ? '✓ Will appear on YOUR balance sheet' : '⚠️ Custodial - will NOT appear on your balance sheet'}
                </p>
              </div>

              {ownerType !== 'own' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Owner Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="e.g., ABC Manufacturing (Pty) Ltd"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500"
                      required
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Owner Reference / ID
                    </label>
                    <input
                      type="text"
                      value={ownerID}
                      onChange={(e) => setOwnerID(e.target.value)}
                      placeholder="Customer ID, Account Number, or Contract Reference"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Custodial Notes
                    </label>
                    <textarea
                      value={custodialNotes}
                      onChange={(e) => setCustodialNotes(e.target.value)}
                      placeholder="Why are we holding these items? Storage agreement details, etc."
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Supplier Selection */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Supplier</h3>
            
            {!showSupplierForm ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Select Supplier <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                    required
                    disabled={loadingSuppliers}
                  >
                    <option value="">Select a supplier...</option>
                    {suppliers.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name} - {supplier.primaryContact.email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowSupplierForm(true)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 whitespace-nowrap"
                  >
                    + New Supplier
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-900 dark:text-white">Create New Supplier</h4>
                  <button
                    type="button"
                    onClick={() => setShowSupplierForm(false)}
                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder="Supplier Name *"
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    type="email"
                    placeholder="Email *"
                    value={newSupplierEmail}
                    onChange={(e) => setNewSupplierEmail(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    type="tel"
                    placeholder="Phone"
                    value={newSupplierPhone}
                    onChange={(e) => setNewSupplierPhone(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreateSupplier}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Create Supplier
                </button>
              </div>
            )}
          </div>

          {/* Delivery Address */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Delivery Address</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Street Address</label>
                <input
                  type="text"
                  value={deliveryStreet}
                  onChange={(e) => setDeliveryStreet(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="123 Main Street"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">City</label>
                <input
                  type="text"
                  value={deliveryCity}
                  onChange={(e) => setDeliveryCity(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="Johannesburg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Province</label>
                <input
                  type="text"
                  value={deliveryProvince}
                  onChange={(e) => setDeliveryProvince(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="Gauteng"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Postal Code</label>
                <input
                  type="text"
                  value={deliveryPostalCode}
                  onChange={(e) => setDeliveryPostalCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="2000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Country</label>
                <input
                  type="text"
                  value={deliveryCountry}
                  onChange={(e) => setDeliveryCountry(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="South Africa"
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Line Items</h3>
              <button
                type="button"
                onClick={addLineItem}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                + Add Item
              </button>
            </div>

            {lineItems.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="text-gray-600 dark:text-gray-400">No items added yet. Click "Add Item" to start.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">#</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Product</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">SKU</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Description</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Qty</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Unit</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Price</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Disc %</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">VAT %</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Total</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {lineItems.map((item, index) => (
                      <tr key={index}>
                        <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{index + 1}</td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            <input
                              type="text"
                              placeholder="Search products..."
                              value={productSearchQuery[index] || ''}
                              onChange={(e) => {
                                const updated = [...productSearchQuery];
                                updated[index] = e.target.value;
                                setProductSearchQuery(updated);
                              }}
                              className="w-full min-w-[180px] px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs"
                            />
                            <select
                              value={item.productId || ''}
                              onChange={(e) => selectProduct(index, e.target.value)}
                              className="w-full min-w-[180px] px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                              size={Math.min(5, getFilteredProducts(index).length + 1)}
                            >
                              <option value="">Select product...</option>
                              {getFilteredProducts(index).slice(0, 50).map(product => (
                                <option key={product.id} value={product.id}>
                                  {product.name} - {product.sku || 'No SKU'} - Stock: {product.stock}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Showing {Math.min(50, getFilteredProducts(index).length)} of {getFilteredProducts(index).length} items
                            </p>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={item.sku}
                            onChange={(e) => updateLineItem(index, 'sku', e.target.value)}
                            className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            placeholder="SKU"
                            disabled={!!item.productId}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                            className="w-full min-w-[150px] px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            placeholder="Description"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={item.quantityOrdered}
                            onChange={(e) => updateLineItem(index, 'quantityOrdered', parseFloat(e.target.value) || 0)}
                            className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            min="0"
                            step="1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={item.unit}
                            onChange={(e) => updateLineItem(index, 'unit', e.target.value)}
                            className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            placeholder="unit"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={item.unitPrice}
                            onChange={(e) => updateLineItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            min="0"
                            step="0.01"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={item.discountPercentage}
                            onChange={(e) => updateLineItem(index, 'discountPercentage', parseFloat(e.target.value) || 0)}
                            className="w-16 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            min="0"
                            max="100"
                            step="0.1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={item.vatRate}
                            onChange={(e) => updateLineItem(index, 'vatRate', parseFloat(e.target.value) || 0)}
                            className="w-16 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            min="0"
                            max="100"
                            step="0.1"
                          />
                        </td>
                        <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(item.total)}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => removeLineItem(index)}
                            className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Financial Summary */}
          <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Financial Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(summary.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Total Discount:</span>
                <span className="font-medium text-red-600 dark:text-red-400">-{formatCurrency(summary.totalDiscount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Total VAT (15%):</span>
                <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(summary.totalVAT)}</span>
              </div>
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-600 dark:text-gray-400">Shipping/Handling:</label>
                <input
                  type="number"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                  className="w-32 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="pt-3 border-t border-gray-300 dark:border-gray-600 flex justify-between">
                <span className="text-lg font-bold text-gray-900 dark:text-white">Grand Total:</span>
                <span className="text-lg font-bold text-green-600 dark:text-green-400">{formatCurrency(summary.grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Additional Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Additional Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes / Comments</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="Any additional notes or special instructions..."
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="approvalRequired"
                  checked={approvalRequired}
                  onChange={(e) => setApprovalRequired(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                />
                <label htmlFor="approvalRequired" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  This purchase order requires approval before sending to supplier
                </label>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={submitting}
            >
              {submitting ? 'Creating...' : 'Create Purchase Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreatePurchaseOrderModal;

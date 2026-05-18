import React, { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';
import * as api from '../services/apiService';
import { API_ENDPOINTS } from '../utils/apiConfig';
import { auth } from '../services/firebase';
import { UserRole } from '../types';
import { CheckCircle, XCircle, Clock, AlertTriangle, User, Calendar, FileText, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

interface ApprovalRequest {
  id: string;
  type: 'zoho_sync';
  action: 'adjust_stock' | 'update_item' | 'create_item' | 'delete_item';
  itemId?: string;
  itemName?: string;
  itemSKU?: string;
  requestedBy: string;
  requestedByName?: string;
  requestedAt: any;
  requestedChange: {
    quantityDelta?: number;
    newQuantity?: number;
    updatedFields?: Record<string, any>;
    reason?: string;
  };
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: any;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: any;
  rejectionReason?: string;
  processed: boolean;
  zohoResponse?: any;
  error?: string;
  source?: 'apk' | 'dashboard'; // Track where the request originated
  stockTakeSessionId?: string; // Group stock take approvals
  stockTakeSessionTimestamp?: string;
  stockTakeItemCount?: number;
}

interface StockTakeSession {
  sessionId: string;
  timestamp: string;
  itemCount: number;
  approvals: ApprovalRequest[];
  requestedBy: string;
  requestedByName: string;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

const ZohoApprovalsView: React.FC = () => {
  const { state } = useAppContext();
  const addToast = useToast();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [filteredApprovals, setFilteredApprovals] = useState<ApprovalRequest[]>([]);
  const [stockTakeSessions, setStockTakeSessions] = useState<StockTakeSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [selectedSession, setSelectedSession] = useState<StockTakeSession | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const currentUser = state.currentUser;
  const currentOrg = state.currentOrganization;

  // Check if current user is admin (only role that can manage approvals in this system)
  const isManagerOrAdmin = currentUser?.role === UserRole.Admin;

  // True when Zoho Books is connected — approval path becomes blocking on Zoho
  const isZohoConnected = currentOrg?.integrations?.zoho?.status === 'connected';

  const [retryInProgress, setRetryInProgress] = useState(false);
  const [pullInProgress, setPullInProgress] = useState(false);

  // Debug logging
  useEffect(() => {
    console.log('ZohoApprovalsView - Current User:', currentUser);
    console.log('ZohoApprovalsView - User Role:', currentUser?.role);
    console.log('ZohoApprovalsView - UserRole.Admin:', UserRole.Admin);
    console.log('ZohoApprovalsView - isManagerOrAdmin:', isManagerOrAdmin);
  }, [currentUser, isManagerOrAdmin]);

  const fetchApprovals = useCallback(async () => {
    if (!currentOrg?.id) return;

    try {
      setIsLoading(true);
      const data = await api.getApprovals(currentOrg.id);
      setApprovals(data);
    } catch (error: any) {
      console.error('Error fetching approvals:', error);
      addToast({ message: `Failed to load approvals: ${error.message}`, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [currentOrg?.id, addToast]);

  useEffect(() => {
    fetchApprovals();
    
    // Listen for real-time stock take sessions updates
    const handleStockTakeUpdate = (event: CustomEvent) => {
      console.log('📊 ZohoApprovalsView received real-time stock take sessions update:', event.detail);
      // The stock take sessions will be processed when we group approvals, so we might need to refetch approvals
      // or update the sessions directly if they match our current approvals
    };
    
    window.addEventListener('stockTakeSessionsUpdate', handleStockTakeUpdate as EventListener);
    
    return () => {
      window.removeEventListener('stockTakeSessionsUpdate', handleStockTakeUpdate as EventListener);
    };
  }, [fetchApprovals]);

  useEffect(() => {
    const handleApprovalsRealtimeUpdate = (event: Event) => {
      const updatedApprovals = (event as CustomEvent<ApprovalRequest[]>).detail;
      console.log('📨 ZohoApprovalsView received real-time approvals update:', updatedApprovals.length);
      setApprovals(updatedApprovals);
      setIsLoading(false);
    };

    window.addEventListener('approvalsUpdate', handleApprovalsRealtimeUpdate as EventListener);
    return () => window.removeEventListener('approvalsUpdate', handleApprovalsRealtimeUpdate as EventListener);
  }, []);

  // Group stock take approvals into sessions and filter by status
  useEffect(() => {
    const sessions = new Map<string, StockTakeSession>();
    
    // First group all stock take approvals by session
    approvals.forEach(approval => {
      if (approval.stockTakeSessionId) {
        if (!sessions.has(approval.stockTakeSessionId)) {
          sessions.set(approval.stockTakeSessionId, {
            sessionId: approval.stockTakeSessionId,
            timestamp: approval.stockTakeSessionTimestamp || approval.requestedAt,
            itemCount: approval.stockTakeItemCount || 1,
            approvals: [],
            requestedBy: approval.requestedBy,
            requestedByName: approval.requestedByName || 'Unknown User'
          });
        }
        sessions.get(approval.stockTakeSessionId)!.approvals.push(approval);
      }
    });

    // Filter sessions based on current filter
    let filteredSessions = Array.from(sessions.values());
    
    if (filter !== 'all') {
      // Only show sessions that have items matching the filter status
      filteredSessions = filteredSessions.filter(session => 
        session.approvals.some(a => a.status === filter)
      );
    }

    setStockTakeSessions(filteredSessions);
  }, [approvals, filter]);

  // Filter approvals based on selected filter
  useEffect(() => {
    if (filter === 'all') {
      setFilteredApprovals(approvals);
    } else {
      setFilteredApprovals(approvals.filter(a => a.status === filter));
    }
  }, [approvals, filter]);

  const handleApprove = async (approvalId: string) => {
    if (!currentOrg?.id || !isManagerOrAdmin) {
      addToast({ message: 'Only managers and admins can approve requests', type: 'error' });
      return;
    }

    try {
      setActionInProgress(approvalId);
      await api.approveZohoSync(currentOrg.id, approvalId, currentUser!.uid, isZohoConnected);
      addToast({ message: isZohoConnected ? 'Approved and sent to Zoho Books!' : 'Request approved successfully!', type: 'success' });
      
      // Refresh approvals list
      await fetchApprovals();
      
      // Close modal if open
      setShowDetailsModal(false);
      setSelectedApproval(null);
    } catch (error: any) {
      console.error('Error approving request:', error);
      addToast({ message: `Failed to approve: ${error.message}`, type: 'error' });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleBulkApprove = async (sessionId: string) => {
    if (!currentOrg?.id || !isManagerOrAdmin) {
      addToast({ message: 'Only managers and admins can approve requests', type: 'error' });
      return;
    }

    const session = stockTakeSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    const pendingApprovals = session.approvals.filter(a => a.status === 'pending');
    if (pendingApprovals.length === 0) {
      addToast({ message: 'No pending approvals in this session', type: 'info' });
      return;
    }

    try {
      setActionInProgress(sessionId);
      addToast({ message: `Approving ${pendingApprovals.length} items...`, type: 'info' });
      
      // Approve all pending items sequentially when Zoho is connected (rate limit safety),
      // parallel when not connected (faster).
      if (isZohoConnected) {
        for (const approval of pendingApprovals) {
          await api.approveZohoSync(currentOrg.id, approval.id, currentUser!.uid, true);
        }
      } else {
        await Promise.all(
          pendingApprovals.map(approval =>
            api.approveZohoSync(currentOrg.id, approval.id, currentUser!.uid, false)
          )
        );
      }
      
      addToast({ 
        message: `Successfully approved ${pendingApprovals.length} items from stock take session`, 
        type: 'success' 
      });
      
      // Refresh approvals list
      await fetchApprovals();
    } catch (error: any) {
      console.error('Error bulk approving:', error);
      addToast({ message: `Failed to approve some items: ${error.message}`, type: 'error' });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleBulkReject = async (sessionId: string, reason: string) => {
    if (!currentOrg?.id || !isManagerOrAdmin) {
      addToast({ message: 'Only managers and admins can reject requests', type: 'error' });
      return;
    }

    if (!reason.trim()) {
      addToast({ message: 'Please provide a reason for rejection', type: 'error' });
      return;
    }

    const session = stockTakeSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    const pendingApprovals = session.approvals.filter(a => a.status === 'pending');
    if (pendingApprovals.length === 0) {
      addToast({ message: 'No pending approvals in this session', type: 'info' });
      return;
    }

    try {
      setActionInProgress(sessionId);
      addToast({ message: `Rejecting ${pendingApprovals.length} items...`, type: 'info' });
      
      // Reject all pending items in parallel
      await Promise.all(
        pendingApprovals.map(approval => 
          api.rejectZohoSync(currentOrg.id, approval.id, currentUser!.uid, reason)
        )
      );
      
      addToast({ 
        message: `Successfully rejected ${pendingApprovals.length} items from stock take session`, 
        type: 'info' 
      });
      
      // Refresh approvals list
      await fetchApprovals();
    } catch (error: any) {
      console.error('Error bulk rejecting:', error);
      addToast({ message: `Failed to reject some items: ${error.message}`, type: 'error' });
    } finally {
      setActionInProgress(null);
    }
  };

  // Send approved-but-unprocessed stock take items to Zoho Books as a single batch adjustment.
  // One Zoho API call per session — avoids rate limits and keeps the Zoho ledger clean.
  const handleRetryZohoSync = async (sessionId?: string) => {
    if (!currentOrg?.id) return;

    // Collect the distinct session IDs that need syncing
    const sessionIds = sessionId
      ? [sessionId]
      : Array.from(
          new Set(
            approvals
              .filter(a => a.status === 'approved' && !a.processed && a.stockTakeSessionId)
              .map(a => a.stockTakeSessionId!)
          )
        );

    if (sessionIds.length === 0) {
      addToast({ message: 'All items are already synced to Zoho Books', type: 'info' });
      return;
    }

    setRetryInProgress(true);

    let totalProcessed = 0;
    let totalSkipped = 0;
    let tokenExpired = false;
    let anyFailed = false;

    for (const sid of sessionIds) {
      const itemsInSession = approvals.filter(
        a => a.stockTakeSessionId === sid && a.status === 'approved' && !a.processed
      ).length;

      addToast({ message: `Sending ${itemsInSession} items to Zoho Books as one batch adjustment…`, type: 'info' });

      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(API_ENDPOINTS.zohoProcessSession(currentOrg.id), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId: sid }),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          totalProcessed += data?.data?.itemsProcessed ?? itemsInSession;
          totalSkipped += data?.data?.itemsSkipped ?? 0;
        } else {
          if (data?.code === 'ZOHO_TOKEN_EXPIRED') tokenExpired = true;
          console.warn(`⚠️ Batch sync failed for session ${sid}:`, data?.message);
          anyFailed = true;
        }
      } catch (err) {
        console.warn('⚠️ Batch sync network error:', err);
        anyFailed = true;
      }
    }

    if (tokenExpired) {
      addToast({ message: 'Zoho token expired — reconnect Zoho in Integrations, then retry.', type: 'error' });
    } else if (!anyFailed) {
      const skippedNote = totalSkipped > 0 ? ` (${totalSkipped} skipped — SKU not in Zoho)` : '';
      addToast({
        message: `${totalProcessed} item${totalProcessed !== 1 ? 's' : ''} sent to Zoho Books as a single batch adjustment!${skippedNote}`,
        type: 'success'
      });
    } else {
      addToast({ message: 'Some sessions failed — check Zoho connection and retry.', type: 'warning' });
    }

    await fetchApprovals();
    setRetryInProgress(false);
  };

  // Pull current stock_on_hand from Zoho Books into the dashboard.
  // Call this AFTER approving the draft adjustment inside Zoho Books.
  const handlePullFromZoho = async () => {
    if (!currentOrg?.id) return;
    setPullInProgress(true);
    try {
      const result = await api.pullQuantitiesFromZoho(currentOrg.id);
      if (result.updated === 0) {
        addToast({ message: 'Quantities are already up to date with Zoho Books.', type: 'info' });
      } else {
        addToast({
          message: `Synced ${result.updated} item ${result.updated === 1 ? 'quantity' : 'quantities'} from Zoho Books.`,
          type: 'success'
        });
      }
    } catch (err: any) {
      addToast({ message: err.message || 'Failed to pull quantities from Zoho.', type: 'error' });
    } finally {
      setPullInProgress(false);
    }
  };

  const handleReject = async (approvalId: string) => {
    if (!currentOrg?.id || !isManagerOrAdmin) {
      addToast({ message: 'Only managers and admins can reject requests', type: 'error' });
      return;
    }

    if (!rejectionReason.trim()) {
      addToast({ message: 'Please provide a reason for rejection', type: 'error' });
      return;
    }

    try {
      setActionInProgress(approvalId);
      await api.rejectZohoSync(currentOrg.id, approvalId, currentUser!.uid, rejectionReason);
      addToast({ message: 'Request rejected', type: 'info' });
      
      // Refresh approvals list
      await fetchApprovals();
      setShowDetailsModal(false);
      setRejectionReason('');
    } catch (error: any) {
      console.error('Error rejecting request:', error);
      addToast({ message: `Failed to reject: ${error.message}`, type: 'error' });
    } finally {
      setActionInProgress(null);
    }
  };

  const openDetailsModal = (approval: ApprovalRequest) => {
    setSelectedApproval(approval);
    setShowDetailsModal(true);
    setRejectionReason('');
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setSelectedApproval(null);
    setRejectionReason('');
  };

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return new Intl.DateTimeFormat('en-ZA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch {
      return 'Invalid date';
    }
  };

  const getActionBadge = (action: string) => {
    const badges = {
      adjust_stock: { text: 'Stock Adjustment', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
      update_item: { text: 'Update Item', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
      create_item: { text: 'Create Item', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
      delete_item: { text: 'Delete Item', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' }
    };
    const badge = badges[action as keyof typeof badges] || { text: action, color: 'bg-gray-100 text-gray-800' };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'approved':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'rejected':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const formatRequestedChange = (change: any): string => {
    if (typeof change === 'string') return change;
    if (!change || typeof change !== 'object') return 'No details available';

    const parts: string[] = [];
    
    if (change.quantityDelta !== undefined) {
      const sign = change.quantityDelta > 0 ? '+' : '';
      parts.push(`${sign}${change.quantityDelta} units`);
    }
    
    if (change.newQuantity !== undefined) {
      parts.push(`New quantity: ${change.newQuantity}`);
    }
    
    if (change.reason) {
      parts.push(change.reason);
    }
    
    return parts.length > 0 ? parts.join(' • ') : 'No details available';
  };

  const pendingCount = approvals.filter(a => a.status === 'pending').length;
  const approvedCount = approvals.filter(a => a.status === 'approved').length;
  const rejectedCount = approvals.filter(a => a.status === 'rejected').length;
  // Items that are approved on the dashboard but haven't been sent to Zoho yet
  const pendingZohoSyncCount = approvals.filter(a => a.status === 'approved' && !a.processed).length;

  if (!isManagerOrAdmin) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
            <div>
              <h3 className="text-lg font-semibold text-yellow-900 dark:text-yellow-100">Access Restricted</h3>
              <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                Only managers and administrators can view and approve Zoho sync requests.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Approvals</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Review and approve inventory changes before syncing to Zoho Books
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pendingZohoSyncCount > 0 && isManagerOrAdmin && (
            <button
              onClick={() => handleRetryZohoSync()}
              disabled={retryInProgress}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 rounded-lg transition-colors"
            >
              {retryInProgress ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Send to Zoho ({pendingZohoSyncCount})
            </button>
          )}
          {isZohoConnected && isManagerOrAdmin && (
            <button
              onClick={handlePullFromZoho}
              disabled={pullInProgress}
              title="Pull approved quantities from Zoho Books into the dashboard. Run this after approving a draft adjustment in Zoho Books."
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-lg transition-colors"
            >
              {pullInProgress ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Sync quantities from Zoho
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Requests</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{approvals.length}</p>
            </div>
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition-shadow"
             onClick={() => setFilter('pending')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending</p>
              <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">{pendingCount}</p>
            </div>
            <Clock className="w-8 h-8 text-yellow-400" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition-shadow"
             onClick={() => setFilter('approved')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Approved</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{approvedCount}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition-shadow"
             onClick={() => setFilter('rejected')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Rejected</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{rejectedCount}</p>
            </div>
            <XCircle className="w-8 h-8 text-red-400" />
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(['all', 'pending', 'approved', 'rejected'] as FilterStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                filter === status
                  ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
              {status !== 'all' && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700">
                  {status === 'pending' ? pendingCount : status === 'approved' ? approvedCount : rejectedCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Stock Take Sessions */}
        {stockTakeSessions.length > 0 && (
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              Stock Take Sessions {filter !== 'all' && `(${filter.charAt(0).toUpperCase() + filter.slice(1)})`}
            </h2>
            <div className="space-y-3">
              {stockTakeSessions.map((session) => {
                const pendingInSession = session.approvals.filter(a => a.status === 'pending').length;
                const approvedInSession = session.approvals.filter(a => a.status === 'approved').length;
                const rejectedInSession = session.approvals.filter(a => a.status === 'rejected').length;
                const unsyncedInSession = session.approvals.filter(a => a.status === 'approved' && !a.processed).length;
                const isProcessing = actionInProgress === session.sessionId;

                return (
                  <div
                    key={session.sessionId}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-indigo-50 dark:bg-indigo-900/20"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                            Stock Take Session
                          </h3>
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                            {session.itemCount} items total
                          </span>
                          {filter !== 'all' && (
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                              Showing {filter}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                          <p>👤 {session.requestedByName}</p>
                          <p>📅 {formatTimestamp(session.timestamp)}</p>
                          <div className="flex gap-3 mt-2 flex-wrap">
                            {pendingInSession > 0 && (
                              <span className="text-yellow-600 dark:text-yellow-400">⏳ {pendingInSession} pending</span>
                            )}
                            {approvedInSession > 0 && (
                              <span className="text-green-600 dark:text-green-400">✓ {approvedInSession} approved</span>
                            )}
                            {rejectedInSession > 0 && (
                              <span className="text-red-600 dark:text-red-400">✗ {rejectedInSession} rejected</span>
                            )}
                            {unsyncedInSession > 0 && (
                              <span className="text-orange-600 dark:text-orange-400 font-medium">⚠ {unsyncedInSession} not yet in Zoho</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button
                        onClick={() => setSelectedSession(session)}
                        className="flex-1 px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-700 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                      >
                        View All Items
                      </button>
                      {unsyncedInSession > 0 && isManagerOrAdmin && (
                        <button
                          onClick={() => handleRetryZohoSync(session.sessionId)}
                          disabled={retryInProgress}
                          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                          {retryInProgress ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                          Send to Zoho ({unsyncedInSession})
                        </button>
                      )}
                      {pendingInSession > 0 && isManagerOrAdmin && (
                        <>
                          <button
                            onClick={() => handleBulkApprove(session.sessionId)}
                            disabled={isProcessing}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-400 rounded-lg transition-colors flex items-center justify-center gap-2"
                          >
                            {isProcessing ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Processing...
                              </>
                            ) : (
                              <>
                                <CheckCircle className="w-4 h-4" />
                                Approve All ({pendingInSession})
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              const reason = prompt('Enter rejection reason for all items:');
                              if (reason) handleBulkReject(session.sessionId, reason);
                            }}
                            disabled={isProcessing}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400 rounded-lg transition-colors flex items-center justify-center gap-2"
                          >
                            {isProcessing ? 'Processing...' : (
                              <>
                                <XCircle className="w-4 h-4" />
                                Reject All ({pendingInSession})
                              </>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Individual Approvals List */}
        <div className="p-6">
          {stockTakeSessions.length > 0 && (
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              Individual Approvals
            </h2>
          )}
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto"></div>
              <p className="text-gray-600 dark:text-gray-400 mt-4">Loading approvals...</p>
            </div>
          ) : filteredApprovals.filter(a => !a.stockTakeSessionId).length === 0 && stockTakeSessions.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">
                {filter === 'pending' 
                  ? 'No pending approval requests'
                  : `No ${filter === 'all' ? '' : filter} approval requests`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredApprovals.filter(a => !a.stockTakeSessionId).map((approval) => (
                <div
                  key={approval.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => openDetailsModal(approval)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      {getStatusIcon(approval.status)}
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                            {approval.itemName || 'Unknown Item'}
                          </h3>
                          {getActionBadge(approval.action)}
                          {approval.source && (
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              approval.source === 'apk' 
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' 
                                : 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200'
                            }`}>
                              {approval.source === 'apk' ? '📱 Mobile' : '🖥️ Dashboard'}
                            </span>
                          )}
                        </div>
                        
                        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                          <p className="flex items-center gap-2">
                            <span className="font-medium">SKU:</span>
                            {approval.itemSKU || 'N/A'}
                          </p>
                          
                          {approval.requestedChange.quantityDelta !== undefined && (
                            <p className="flex items-center gap-2">
                              <span className="font-medium">Change:</span>
                              <span className={`flex items-center gap-1 ${
                                approval.requestedChange.quantityDelta > 0 
                                  ? 'text-green-600 dark:text-green-400' 
                                  : 'text-red-600 dark:text-red-400'
                              }`}>
                                {approval.requestedChange.quantityDelta > 0 ? (
                                  <TrendingUp className="w-4 h-4" />
                                ) : (
                                  <TrendingDown className="w-4 h-4" />
                                )}
                                {approval.requestedChange.quantityDelta > 0 ? '+' : ''}
                                {approval.requestedChange.quantityDelta} units
                              </span>
                            </p>
                          )}
                          
                          {approval.requestedChange.reason && (
                            <p className="flex items-center gap-2">
                              <span className="font-medium">Reason:</span>
                              {approval.requestedChange.reason}
                            </p>
                          )}
                          
                          <p className="flex items-center gap-2">
                            <User className="w-4 h-4" />
                            <span className="font-medium">Requested by:</span>
                            {approval.requestedByName || 'Unknown User'}
                          </p>
                          
                          <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            {formatTimestamp(approval.requestedAt)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons for pending requests */}
                    {approval.status === 'pending' && (
                      <div className="flex gap-2 ml-4" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleApprove(approval.id)}
                          disabled={actionInProgress === approval.id}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {actionInProgress === approval.id ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => openDetailsModal(approval)}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Show approval/rejection info */}
                  {approval.status === 'approved' && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-sm text-green-600 dark:text-green-400">
                        ✓ Approved by {approval.approvedByName || 'Unknown'} on {formatTimestamp(approval.approvedAt)}
                      </p>
                      {approval.processed && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Synced to Zoho Books
                        </p>
                      )}
                    </div>
                  )}

                  {approval.status === 'rejected' && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-sm text-red-600 dark:text-red-400">
                        ✗ Rejected by {approval.rejectedByName || 'Unknown'} on {formatTimestamp(approval.rejectedAt)}
                      </p>
                      {approval.rejectionReason && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          Reason: {approval.rejectionReason}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      {showDetailsModal && selectedApproval && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full h-[95vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Approval Details</h2>
                <button
                  onClick={closeDetailsModal}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item</label>
                  <p className="text-gray-900 dark:text-gray-100">{selectedApproval.itemName || 'Unknown Item'}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">SKU: {selectedApproval.itemSKU || 'N/A'}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Action</label>
                  {getActionBadge(selectedApproval.action)}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Requested Changes</label>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-3">
                    {selectedApproval.requestedChange?.quantityDelta !== undefined && (
                      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Quantity Change</span>
                        <span className={`text-lg font-bold ${
                          selectedApproval.requestedChange.quantityDelta > 0 
                            ? 'text-green-600 dark:text-green-400' 
                            : 'text-red-600 dark:text-red-400'
                        }`}>
                          {selectedApproval.requestedChange.quantityDelta > 0 ? '+' : ''}
                          {selectedApproval.requestedChange.quantityDelta}
                        </span>
                      </div>
                    )}
                    {selectedApproval.requestedChange?.newQuantity !== undefined && (
                      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">New Quantity</span>
                        <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                          {selectedApproval.requestedChange.newQuantity}
                        </span>
                      </div>
                    )}
                    {selectedApproval.requestedChange?.reason && (
                      <div className="pt-1">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400 block mb-1">Reason</span>
                        <p className="text-gray-900 dark:text-gray-100 text-sm bg-white dark:bg-gray-900 rounded px-3 py-2 border border-gray-200 dark:border-gray-700">
                          {selectedApproval.requestedChange.reason}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Requested By</label>
                  <p className="text-gray-900 dark:text-gray-100">{selectedApproval.requestedByName || 'Unknown User'}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{formatTimestamp(selectedApproval.requestedAt)}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(selectedApproval.status)}
                    <span className="capitalize text-gray-900 dark:text-gray-100">{selectedApproval.status}</span>
                  </div>
                </div>

                {selectedApproval.status === 'pending' && (
                  <div>
                    <label htmlFor="rejectionReason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Rejection Reason (Required to reject)
                    </label>
                    <textarea
                      id="rejectionReason"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Explain why this request is being rejected..."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-gray-100"
                      rows={3}
                    />
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={closeDetailsModal}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>
                
                {selectedApproval.status === 'pending' && (
                  <>
                    <button
                      onClick={() => handleReject(selectedApproval.id)}
                      disabled={!rejectionReason.trim() || actionInProgress === selectedApproval.id}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionInProgress === selectedApproval.id ? 'Rejecting...' : 'Reject Request'}
                    </button>
                    <button
                      onClick={() => handleApprove(selectedApproval.id)}
                      disabled={actionInProgress === selectedApproval.id}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionInProgress === selectedApproval.id ? 'Approving...' : 'Approve Request'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Take Session Details Modal */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-5xl mx-4 h-[95vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    Stock Take Session Details
                  </h2>
                  <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                    <p>👤 Requested by: {selectedSession.requestedByName}</p>
                    <p>📅 {formatTimestamp(selectedSession.timestamp)}</p>
                    <p>📦 {selectedSession.itemCount} items scanned</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedSession(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-3">
                {selectedSession.approvals.map((approval) => (
                  <div
                    key={approval.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                            {approval.itemName}
                          </h3>
                          {approval.itemSKU && (
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              SKU: {approval.itemSKU}
                            </span>
                          )}
                        </div>
                        {approval.requestedChange && (
                          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                            {formatRequestedChange(approval.requestedChange)}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-sm">
                          {getStatusIcon(approval.status)}
                          <span className={`font-medium ${
                            approval.status === 'approved' ? 'text-green-600 dark:text-green-400' :
                            approval.status === 'rejected' ? 'text-red-600 dark:text-red-400' :
                            'text-yellow-600 dark:text-yellow-400'
                          }`}>
                            {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)}
                          </span>
                        </div>
                      </div>
                      {approval.status === 'pending' && isManagerOrAdmin && (
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedApproval(approval);
                              setSelectedSession(null);
                              setShowDetailsModal(true);
                            }}
                            className="px-3 py-1 text-sm text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-700 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/40"
                          >
                            Details
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {selectedSession.approvals.filter(a => a.status === 'pending').length} pending • {' '}
                {selectedSession.approvals.filter(a => a.status === 'approved').length} approved • {' '}
                {selectedSession.approvals.filter(a => a.status === 'rejected').length} rejected
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setSelectedSession(null)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Close
                </button>
                {selectedSession.approvals.filter(a => a.status === 'pending').length > 0 && isManagerOrAdmin && (
                  <>
                    <button
                      onClick={() => {
                        const reason = prompt('Enter rejection reason for all pending items:');
                        if (reason) {
                          handleBulkReject(selectedSession.sessionId, reason);
                          setSelectedSession(null);
                        }
                      }}
                      disabled={actionInProgress === selectedSession.sessionId}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Reject All Pending
                    </button>
                    <button
                      onClick={() => {
                        handleBulkApprove(selectedSession.sessionId);
                        setSelectedSession(null);
                      }}
                      disabled={actionInProgress === selectedSession.sessionId}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Approve All Pending
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZohoApprovalsView;

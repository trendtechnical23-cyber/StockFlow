import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';
import { supabase } from '../services/supabase';
import { activityLogger } from '../services/activityLogger';
import { createApprovalRequest } from '../services/apiService';
import { UserRole } from '../types';
import LiveScanPanel from '../components/LiveScanPanel';

/**
 * Stock Take Monitor View (RTDB-based)
 * 
 * This view allows managers to monitor active stock take sessions
 * and approve/reject pending stock take submissions.
 * 
 * Reads from RTDB path: organizations/{orgId}/stockTakeSessions/{sessionId}
 */

interface ScannedItem {
  itemId: string;
  itemName: string;
  sku: string;
  scannedQuantity: number;
  expectedQuantity: number;
  variance: number;
  scannedBy: string;
  scannedByName: string;
  scannedAt: number;
  deviceId: string;
}

interface StockTakeSession {
  id: string;
  deviceId: string;
  /** Human-readable device model name (e.g. "TC15"). Prefer over deviceId for display. */
  deviceName?: string;
  userName: string;
  userEmail: string;
  startTime: number;
  endTime?: number;
  status: 'ACTIVE' | 'PENDING_SYNC' | 'COMPLETED' | 'CANCELLED' | 'PENDING_APPROVAL';
  itemsScanned?: number;
  scannedItems?: { [key: string]: ScannedItem };
  participantDevices?: string[];
  sessionData?: any; // Full session data from RTDB
  firebaseKey?: string; // Firebase key for this session
  source?: 'mobile_app' | 'rtdb'; // Distinguish APK vs RTDB sessions
  displayName?: string; // Professional display name for APK sessions
}

const MonitorIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
    <line x1="8" y1="21" x2="16" y2="21"></line>
    <line x1="12" y1="17" x2="12" y2="21"></line>
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const StockTakeMonitorView: React.FC = () => {
  const { state } = useAppContext();
  const addToast = useToast();
  const [activeSessions, setActiveSessions] = useState<StockTakeSession[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<StockTakeSession[]>([]);
  const [apkSessions, setApkSessions] = useState<StockTakeSession[]>([]); // Store APK sessions separately
  const apkSessionsRef = useRef<StockTakeSession[]>([]); // Ref for RTDB closure access
  const [loggedSessionIds, setLoggedSessionIds] = useState<Set<string>>(new Set()); // Track logged sessions
  const [selectedSession, setSelectedSession] = useState<StockTakeSession | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Check if user is admin (note: using currentUser, not user)
  const isAdmin = state.currentUser?.role === UserRole.Admin;

  // Load active/live sessions using centralized service with enhanced monitoring
  useEffect(() => {
    if (!state.currentOrganization?.id) {
      console.warn('⚠️ No organization ID available for stock take monitor:', state.currentOrganization);
      return;
    }

    console.log('📊 Setting up stock take monitoring for organization:', state.currentOrganization.id);

    // Listen for real-time stock take sessions updates from AppContext
    const handleStockTakeUpdate = (event: CustomEvent) => {
      console.log('📊 StockTakeMonitorView received real-time stock take sessions update:', event.detail);
      const sessions = event.detail as any[];
      
      // Filter and process sessions for monitoring
      const pendingSessions = sessions.filter(s => 
        s.status === 'COMPLETED' || s.status === 'ACTIVE' || s.status === 'PENDING_APPROVAL'
      );
      
      const processedSessions = pendingSessions.map((session: any) => ({
        id: session.id,
        deviceId: session.deviceId || 'unknown',
        deviceName: session.deviceName || undefined,
        userName: session.userName || 'Mobile User',
        userEmail: session.userEmail || 'mobile@stockflow.com',
        startTime: session.startTime || Date.now(),
        endTime: session.endTime,
        status: session.status || 'PENDING_APPROVAL' as const,
        itemsScanned: session.itemsScanned || 0,
        scannedItems: session.scannedItems || [],
        participantDevices: [],
        source: 'mobile_app',
        displayName: session.id
      }));
      
      console.log('📊 Processed sessions for monitoring:', processedSessions.length);
      setApkSessions(processedSessions);
      apkSessionsRef.current = processedSessions;
    };
    
    window.addEventListener('stockTakeSessionsUpdate', handleStockTakeUpdate as EventListener);

    // Load sessions from Supabase (replaces Firestore loadAPKSessions)
    const loadSessions = async () => {
      try {
        const { data, error } = await supabase
          .from('stock_take_sessions')
          .select(`
            *,
            stock_take_entries (
              id, item_id, sku, counted_quantity, expected_quantity, scanned_at,
              inventory_items ( name, sku, category )
            ),
            users!started_by ( full_name, email )
          `)
          .eq('org_id', state.currentOrganization.id)
          .in('status', ['open', 'closed'])
          .order('started_at', { ascending: false })
          .limit(50);

        if (error) {
          console.error('❌ Error getting stock take sessions:', error);
          return;
        }

        const sessions: StockTakeSession[] = (data ?? []).map((row: any) => {
          // Build scannedItems dict from entries
          const scannedItems: { [key: string]: any } = {};
          (row.stock_take_entries ?? []).forEach((entry: any) => {
            const key = entry.item_id || entry.id;
            const itemInfo = entry.inventory_items;
            scannedItems[key] = {
              itemId: entry.item_id,
              itemName: itemInfo?.name || entry.sku || 'Unknown Item',
              sku: entry.sku || itemInfo?.sku || '',
              category: itemInfo?.category || '',
              scannedQuantity: entry.counted_quantity,
              expectedQuantity: entry.expected_quantity ?? 0,
              variance: entry.counted_quantity - (entry.expected_quantity ?? 0),
              scannedAt: entry.scanned_at ? new Date(entry.scanned_at).getTime() : null,
            };
          });

          const startMs = row.started_at ? new Date(row.started_at).getTime() : Date.now();
          const endMs = row.closed_at ? new Date(row.closed_at).getTime() : undefined;
          const userName = row.users?.full_name || row.users?.email || row.name || 'Mobile User';
          const itemCount = Object.keys(scannedItems).length;

          return {
            id: row.id,
            deviceId: row.name || row.id,
            deviceName: row.name || undefined,
            userName,
            userEmail: row.users?.email || '',
            startTime: startMs,
            endTime: endMs,
            status: (row.status === 'open' ? 'ACTIVE' : 'PENDING_APPROVAL') as StockTakeSession['status'],
            itemsScanned: itemCount,
            scannedItems,
            participantDevices: [],
            source: 'mobile_app' as const,
            displayName: row.name || row.id.slice(-8),
          };
        });

        setApkSessions(sessions);
        apkSessionsRef.current = sessions;
        setActiveSessions(sessions.filter(s => s.status === 'ACTIVE'));
        setPendingApprovals(sessions.filter(s => s.status === 'PENDING_APPROVAL'));

        console.log(`📋 Loaded ${sessions.length} stock take session(s) from Supabase`);
      } catch (err) {
        console.error('❌ Error getting stock take sessions:', err);
      }
    };

    loadSessions();

    // Real-time subscription via Supabase Realtime (replaces RTDB subscriptions)
    const channel = supabase
      .channel(`stock-take-monitor:${state.currentOrganization.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stock_take_sessions', filter: `org_id=eq.${state.currentOrganization.id}` },
        () => { loadSessions(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stock_take_entries', filter: `org_id=eq.${state.currentOrganization.id}` },
        () => { loadSessions(); }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('🔔 Stock take monitor channel active');
        }
      });

    return () => {
      supabase.removeChannel(channel);
      // Clean up real-time listener
      window.removeEventListener('stockTakeSessionsUpdate', handleStockTakeUpdate as EventListener);
    };
  }, [state.currentOrganization?.id]);

  // Combine APK sessions with RTDB sessions whenever APK sessions change
  useEffect(() => {
    if (apkSessions.length > 0) {
      setPendingApprovals(prev => {
        const rtdbSessions = prev.filter(s => s.source === 'rtdb');
        const combinedSessions = [...apkSessions, ...rtdbSessions];
        console.log('🔄 APK sessions updated - APK:', apkSessions.length, 'RTDB:', rtdbSessions.length, 'Total:', combinedSessions.length);
        return combinedSessions;
      });
    }
  }, [apkSessions]);

  const formatSessionName = (session: StockTakeSession) => {
    // Use displayName for APK sessions, fallback to formatted date for RTDB sessions
    if (session.displayName) {
      return session.displayName;
    }
    
    const date = new Date(session.startTime);
    return date.toLocaleString('en-ZA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleSessionClick = async (session: StockTakeSession) => {
    // Items are already loaded from stockTakeApprovals, just show the modal
    setSelectedSession(session);
    setShowDetailsModal(true);
  };

  const exportSessionToCSV = (session: StockTakeSession) => {
    if (!session.scannedItems || Object.keys(session.scannedItems).length === 0) {
      addToast({ message: 'No items to export', type: 'error' });
      return;
    }

    // Simple CSV headers - essential columns plus user
    const csvRows = [
      [
        'Stock Take ID',
        'Session Date',
        'Item Name', 
        'SKU', 
        'Category',
        'Description',
        'Expected Quantity', 
        'Scanned Quantity',
        'Variance',
        'Variance %',
        'Variance Type',
        'Scanned Date',
        'Scanned Time',
        'Scanned By'
      ].join(',')
    ];

    const sessionStart = new Date(session.startTime);
    const sessionDate = sessionStart.toLocaleDateString('en-ZA');

    Object.values(session.scannedItems).forEach((item: any) => {
      // Debug and fix the N/A date issue
      let scannedDate = 'N/A';
      let scannedTime = 'N/A';
      
      console.log('Debug item scannedAt:', item.scannedAt, typeof item.scannedAt);
      
      if (item.scannedAt) {
        try {
          // Try different ways to parse the date
          let scannedDateTime;
          if (typeof item.scannedAt === 'number') {
            scannedDateTime = new Date(item.scannedAt);
          } else if (typeof item.scannedAt === 'string') {
            scannedDateTime = new Date(item.scannedAt);
          } else if (item.scannedAt.toDate) {
            // Firestore Timestamp
            scannedDateTime = item.scannedAt.toDate();
          } else {
            scannedDateTime = new Date(item.scannedAt);
          }
          
          if (!isNaN(scannedDateTime.getTime())) {
            scannedDate = scannedDateTime.toLocaleDateString('en-ZA');
            scannedTime = scannedDateTime.toLocaleTimeString('en-ZA');
          } else {
            console.warn('Invalid parsed date:', scannedDateTime);
            // Fallback to session date if item date is invalid
            scannedDate = sessionDate;
            scannedTime = sessionStart.toLocaleTimeString('en-ZA');
          }
        } catch (e) {
          console.warn('Error parsing scannedAt date:', item.scannedAt, e);
          // Fallback to session date
          scannedDate = sessionDate;
          scannedTime = sessionStart.toLocaleTimeString('en-ZA');
        }
      } else {
        // No scannedAt data, use session date as fallback
        scannedDate = sessionDate;
        scannedTime = sessionStart.toLocaleTimeString('en-ZA');
      }

      const variance = (item.scannedQuantity || 0) - (item.expectedQuantity || 0);
      const variancePercent = (item.expectedQuantity || 0) > 0 ? 
        Math.round((variance / (item.expectedQuantity || 1)) * 100) : 0;
      const varianceType = variance > 0 ? 'Surplus' : variance < 0 ? 'Shortage' : 'Match';
      
      csvRows.push([
        `"${session.id}"`,
        `"${sessionDate}"`,
        `"${(item.itemName || item.name || '').replace(/"/g, '""')}"`,
        `"${item.sku || ''}"`,
        `"${item.category || 'Unassigned'}"`,
        `"${(item.description || '').replace(/"/g, '""')}"`,
        item.expectedQuantity || 0,
        item.scannedQuantity || 0,
        variance,
        `${variancePercent}%`,
        `"${varianceType}"`,
        `"${scannedDate}"`,
        `"${scannedTime}"`,
        `"${item.scannedByName || item.scannedBy || session.userName || 'Unknown'}"`
      ].join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const dateStr = sessionStart.toISOString().split('T')[0];
    const sessionIdShort = session.id.split('_').pop() || session.id.slice(-6);
    link.setAttribute('href', url);
    link.setAttribute('download', `StockTake_${dateStr}_${sessionIdShort}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    addToast({ message: 'Stock take exported successfully', type: 'success' });
  };

  const exportAllSessionsToCSV = () => {
    if (pendingApprovals.length === 0) {
      addToast({ message: 'No sessions to export', type: 'error' });
      return;
    }

    // Match the enhanced individual export structure
    const csvRows = [
      [
        'Stock Take ID',
        'Session Date',
        'Item Name', 
        'SKU', 
        'Category',
        'Description',
        'Expected Quantity', 
        'Scanned Quantity',
        'Variance',
        'Variance %',
        'Variance Type',
        'Scanned Date',
        'Scanned Time',
        'Scanned By',
        'Session User',
        'Device ID'
      ].join(',')
    ];

    pendingApprovals.forEach(session => {
      const sessionStart = new Date(session.startTime);
      const sessionDate = sessionStart.toLocaleDateString('en-ZA');
      
      if (session.scannedItems && Object.keys(session.scannedItems).length > 0) {
        Object.values(session.scannedItems).forEach((item: any) => {
          // Enhanced date handling to match individual export
          let scannedDate = 'N/A';
          let scannedTime = 'N/A';
          
          if (item.scannedAt) {
            try {
              let scannedDateTime;
              if (typeof item.scannedAt === 'number') {
                scannedDateTime = new Date(item.scannedAt);
              } else if (typeof item.scannedAt === 'string') {
                scannedDateTime = new Date(item.scannedAt);
              } else if (item.scannedAt.toDate) {
                scannedDateTime = item.scannedAt.toDate();
              } else {
                scannedDateTime = new Date(item.scannedAt);
              }
              
              if (!isNaN(scannedDateTime.getTime())) {
                scannedDate = scannedDateTime.toLocaleDateString('en-ZA');
                scannedTime = scannedDateTime.toLocaleTimeString('en-ZA');
              } else {
                scannedDate = sessionDate;
                scannedTime = sessionStart.toLocaleTimeString('en-ZA');
              }
            } catch (e) {
              scannedDate = sessionDate;
              scannedTime = sessionStart.toLocaleTimeString('en-ZA');
            }
          } else {
            scannedDate = sessionDate;
            scannedTime = sessionStart.toLocaleTimeString('en-ZA');
          }

          // Calculate variance percentage and type
          const variance = (item.variance || 0);
          const expectedQty = item.expectedQuantity || 0;
          const variancePercentage = expectedQty > 0 ? ((variance / expectedQty) * 100).toFixed(1) : '0.0';
          const varianceType = variance > 0 ? 'Overage' : variance < 0 ? 'Shortage' : 'Match';

          csvRows.push([
            `"${session.id}"`,
            `"${sessionDate}"`,
            `"${item.itemName || 'N/A'}"`,
            `"${item.sku || 'N/A'}"`,
            `"${item.category || 'Uncategorized'}"`,
            `"${item.description || item.itemName || 'N/A'}"`,
            item.expectedQuantity || 0,
            item.scannedQuantity || 0,
            variance,
            `${variancePercentage}%`,
            `"${varianceType}"`,
            `"${scannedDate}"`,
            `"${scannedTime}"`,
            `"${item.scannedByName || item.scannedBy || 'Unknown'}"`,
            `"${session.userName}"`,
            `"${session.deviceName || session.userName || session.deviceId}"`
          ].join(','));
        });
      }
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `all_stock_takes_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Count total items exported
    const totalItems = pendingApprovals.reduce((sum, session) => {
      return sum + (session.scannedItems ? Object.keys(session.scannedItems).length : 0);
    }, 0);

    addToast({ 
      message: `Exported ${pendingApprovals.length} sessions (${totalItems} items) successfully`, 
      type: 'success' 
    });
  };

  const handleApprove = async (sessionId: string) => {
    console.log('[DEBUG] handleApprove called with sessionId:', sessionId);
    if (!state.currentUser) {
      addToast({ message: 'User not authenticated', type: 'error' });
      return;
    }
    
    // Find session to determine if it's APK or RTDB
    const session = pendingApprovals.find(s => s.id === sessionId);
    if (!session) {
      addToast({ message: 'Session not found', type: 'error' });
      return;
    }

    try {
      // Mark session as approved in Supabase
      const { error: updateError } = await supabase
        .from('stock_take_sessions')
        .update({
          status: 'approved',
          approved_by: state.currentUser?.uid ?? null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      if (updateError) throw updateError;

      // Collect scanned items (handle both array and object representations)
      const rawItems = session.scannedItems;
      const itemsArray: any[] = rawItems
        ? Array.isArray(rawItems)
          ? rawItems
          : Object.values(rawItems)
        : [];

      // Create approval requests only for items with discrepancy (variance !== 0)
      const itemsWithVariance = itemsArray.filter(
        (item: any) => item.variance !== 0 || (item.scannedQuantity !== item.expectedQuantity)
      );

      let approvalCount = 0;
      if (itemsWithVariance.length > 0) {
        await Promise.all(
          itemsWithVariance.map(async (item: any) => {
            const variance = item.variance ?? (item.scannedQuantity - (item.expectedQuantity ?? 0));
            await createApprovalRequest(state.currentOrganization.id, {
              type: 'zoho_sync' as any,
              action: 'adjust_stock' as any,
              itemId: item.itemId,
              itemName: item.itemName || item.name || 'Unknown Item',
              itemSKU: item.sku || '',
              requestedBy: session.userEmail || state.currentUser?.uid || '',
              requestedByName: session.userName || 'Mobile User',
              requestedChange: {
                quantityDelta: variance,
                newQuantity: item.scannedQuantity,
                reason: `Stock take session ${sessionId} — scanned ${item.scannedQuantity}, expected ${item.expectedQuantity ?? 0}`,
              },
              stockTakeSessionId: sessionId,
              stockTakeSessionTimestamp: new Date(session.startTime).toISOString(),
              source: 'stock_take' as any,
            });
            approvalCount++;
          })
        );
      }

      // Activity log via Supabase
      await activityLogger.log(state.currentOrganization.id, {
        action: 'Stock Take Approved',
        category: 'INVENTORY',
        description: `Admin approved stock take session by ${session.userName} containing ${session.itemsScanned} scanned items. ${approvalCount} item adjustment${approvalCount !== 1 ? 's' : ''} sent for approval.`,
        targetType: 'item',
        targetName: session.displayName || session.id,
        metadata: {
          sessionId: session.id,
          originalUser: session.userName,
          deviceId: session.deviceId,
          itemsScanned: session.itemsScanned,
          approvalRequestsCreated: approvalCount,
        },
      });

      // Remove from UI immediately (Realtime will also refresh)
      setPendingApprovals(prev => prev.filter(s => s.id !== sessionId));
      setApkSessions(prev => prev.filter(s => s.id !== sessionId));
      apkSessionsRef.current = apkSessionsRef.current.filter(s => s.id !== sessionId);

      if (approvalCount > 0) {
        addToast({
          message: `Stock take approved! ${approvalCount} item adjustment${approvalCount !== 1 ? 's' : ''} created — pending admin approval.`,
          type: 'success'
        });
      } else {
        addToast({ message: 'Stock take approved — no quantity discrepancies found.', type: 'success' });
      }
      setShowDetailsModal(false);
    } catch (error) {
      console.error('Error approving session:', error);
      addToast({ message: 'Failed to approve session', type: 'error' });
    }
  };

  const handleReject = async (sessionId: string) => {
    console.log('[DEBUG] handleReject called with sessionId:', sessionId);
    
    // Find session to determine if it's APK or RTDB
    const session = pendingApprovals.find(s => s.id === sessionId);
    if (!session) {
      addToast({ message: 'Session not found', type: 'error' });
      return;
    }

    try {
      // Mark session as rejected in Supabase
      const { error: updateError } = await supabase
        .from('stock_take_sessions')
        .update({ status: 'rejected' })
        .eq('id', sessionId);

      if (updateError) throw updateError;

      // Activity log via Supabase
      await activityLogger.log(state.currentOrganization.id, {
        action: 'Stock Take Rejected',
        category: 'INVENTORY',
        description: `Admin rejected stock take session by ${session.userName} containing ${session.itemsScanned} scanned items`,
        targetType: 'item',
        targetName: session.displayName || session.id,
        metadata: {
          sessionId: session.id,
          originalUser: session.userName,
          deviceId: session.deviceId,
          itemsScanned: session.itemsScanned,
        },
      });

      // Remove from UI immediately
      setPendingApprovals(prev => prev.filter(s => s.id !== sessionId));
      setApkSessions(prev => prev.filter(s => s.id !== sessionId));
      apkSessionsRef.current = apkSessionsRef.current.filter(s => s.id !== sessionId);

      addToast({ message: 'Stock take session rejected', type: 'info' });
    } catch (error) {
      console.error('Error rejecting session:', error);
      addToast({ message: 'Failed to reject session', type: 'error' });
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <MonitorIcon />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Stock Take Monitor
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Monitor active stock take sessions and review pending approvals
          </p>
        </div>

        {/* Live Scan Feed */}
        {state.currentOrganization?.id && (
          <LiveScanPanel orgId={state.currentOrganization.id} />
        )}

        {/* Pending Approvals */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Pending Approvals ({pendingApprovals.length})
            </h2>
            {pendingApprovals.length > 0 && (
              <button
                onClick={exportAllSessionsToCSV}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-sm hover:shadow-md transition-all duration-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export All Sessions
              </button>
            )}
          </div>
          <div className="p-6">
            {pendingApprovals.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400">
                  No pending approvals
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingApprovals.map(session => (
                  <div
                    key={session.id}
                    onClick={() => handleSessionClick(session)}
                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {formatSessionName(session)}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {session.userName} • Items scanned: {session.itemsScanned}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {isAdmin && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReject(session.id);
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 shadow-sm hover:shadow-md transition-all duration-200"
                          >
                            <XIcon />
                            Reject
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApprove(session.id);
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm hover:shadow-md transition-all duration-200"
                          >
                            <CheckIcon />
                            Approve
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Info Banner */}
        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300">
                Stock Take Monitoring
              </h3>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
                This page shows real-time stock take sessions from mobile devices. 
                Approve or reject submissions to update inventory counts.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Session Details Modal */}
      {showDetailsModal && selectedSession && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDetailsModal(false)}>
          <style>{`
            .custom-scrollbar::-webkit-scrollbar {
              width: 8px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
              background: rgba(156, 163, 175, 0.1);
              border-radius: 4px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
              background: rgba(59, 130, 246, 0.5);
              border-radius: 4px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
              background: rgba(59, 130, 246, 0.7);
            }
            .dark .custom-scrollbar::-webkit-scrollbar-thumb {
              background: rgba(96, 165, 250, 0.3);
            }
            .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
              background: rgba(96, 165, 250, 0.5);
            }
          `}</style>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Session Details
              </h2>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
              >
                <XIcon />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Session Date/Time</p>
                <p className="text-lg font-medium text-gray-900 dark:text-white">
                  {formatSessionName(selectedSession)}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">User</p>
                <p className="text-lg font-medium text-gray-900 dark:text-white">
                  {selectedSession.userName}
                </p>
                {selectedSession.userEmail && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {selectedSession.userEmail}
                  </p>
                )}
              </div>

              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Device</p>
                <p className="text-lg font-medium text-gray-900 dark:text-white">
                  {selectedSession.deviceName || selectedSession.userName || selectedSession.deviceId}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                <span className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${
                  selectedSession.status === 'ACTIVE' 
                    ? 'text-green-800 bg-green-100' 
                    : selectedSession.status === 'PENDING_SYNC'
                    ? 'text-yellow-800 bg-yellow-100'
                    : 'text-orange-800 bg-orange-100'
                }`}>
                  {selectedSession.status === 'ACTIVE' ? '🟢 Live' : 
                   selectedSession.status === 'PENDING_SYNC' ? '📤 Pending Sync' :
                   '⏸️ Pending Approval'}
                </span>
              </div>

              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Items Scanned</p>
                <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                  {selectedSession.itemsScanned || 0}
                </p>
              </div>

              {selectedSession.endTime && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Ended At</p>
                  <p className="text-lg font-medium text-gray-900 dark:text-white">
                    {new Date(selectedSession.endTime).toLocaleString('en-ZA')}
                  </p>
                </div>
              )}

              {/* Scanned Items List */}
              {selectedSession.scannedItems && Object.keys(selectedSession.scannedItems).length > 0 && (
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                    Scanned Items ({Object.keys(selectedSession.scannedItems).length})
                  </p>
                  <div className="max-h-96 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {Object.entries(selectedSession.scannedItems).map(([key, item]: [string, any]) => (
                      <div key={key} className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 dark:text-white">
                              {item.itemName || 'Unknown Item'}
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              SKU: {item.sku || ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-semibold text-gray-900 dark:text-white">
                              {item.scannedQuantity || 0}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Expected: {item.expectedQuantity || 0}
                            </p>
                            {(item.variance || 0) !== 0 && (
                              <p className={`text-xs font-medium ${
                                (item.variance || 0) > 0 
                                  ? 'text-green-600 dark:text-green-400' 
                                  : 'text-red-600 dark:text-red-400'
                              }`}>
                                {(item.variance || 0) > 0 ? '+' : ''}{item.variance || 0}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Session ID</p>
                <p className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 p-2 rounded">
                  {selectedSession.id}
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
              <button
                onClick={() => exportSessionToCSV(selectedSession)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-sm hover:shadow-md transition-all duration-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export CSV
              </button>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="px-5 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 shadow-sm hover:shadow-md transition-all duration-200"
                >
                  Close
                </button>
                {selectedSession.status === 'COMPLETED' && isAdmin && (
                  <>
                    <button
                      onClick={() => {
                        handleReject(selectedSession.id);
                        setShowDetailsModal(false);
                      }}
                      className="px-5 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 shadow-sm hover:shadow-md transition-all duration-200"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => {
                        handleApprove(selectedSession.id);
                        setShowDetailsModal(false);
                      }}
                      className="px-5 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm hover:shadow-md transition-all duration-200"
                    >
                      Approve
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

export default StockTakeMonitorView;

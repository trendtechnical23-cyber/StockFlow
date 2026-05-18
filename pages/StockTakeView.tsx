import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';
import { useStockTake } from '../hooks/useStockTake'; 
import { DiscrepancyItem } from '../types';
import { useLiveTimer } from '../hooks/useLiveTimer';

type StockTakePhase = 'idle' | 'in_progress' | 'review';

// Icons
const StartIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><rect x="9" y="9" width="6" height="6"></rect></svg>;
const SyncIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>;
const ExportIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const ClipboardIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>;

const StockTakeView: React.FC = () => {
    console.log('🚀 StockTakeView component mounted!');
    
    const { state, dispatch, handleUpdateItem } = useAppContext();
    const { inventory, users } = state;
    const addToast = useToast();
    const { 
        activeSession, 
        isSessionActive, 
        startStockTakeSession: startRealtimeSession, 
        endStockTakeSession: endRealtimeSession,
        getSessionSummary,
        sendTestNotification,
        notifications,
        allSessions
    } = useStockTake();
    
    const [phase, setPhase] = useState<StockTakePhase>('idle');
    const liveTime = useLiveTimer(activeSession?.startTime);
    
    // Update phase based on active session - only when actually needed
    useEffect(() => {
        // Only update phase if there's a real session change and we're on the stock take page
        const currentPath = window.location.pathname;
        if (currentPath.includes('stockTake') || currentPath.includes('stock-take')) {
            if (activeSession && activeSession.status === 'ACTIVE' && phase === 'idle') {
                setPhase('in_progress');
                console.log('📋 Active session detected on StockTake page, updating phase to in_progress');
            } else if (phase === 'in_progress' && !activeSession) {
                setPhase('idle');
                console.log('📋 No active session, resetting phase to idle');
            }
        }
    }, [activeSession, phase]);
    const [discrepancyReport, setDiscrepancyReport] = useState<DiscrepancyItem[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    
    const handleStart = async () => {
        try {
            // Clear UI-only progress data (simulation removed)
            setDiscrepancyReport([]);
            
            // Start real-time session
            const sessionId = await startRealtimeSession();
            if (sessionId) {
                setPhase('in_progress');
                // Removed duplicate ADD_LOG - realtimeNotificationService handles notifications
                addToast({ message: '📋 Stock take started! Real-time notifications sent to all APK devices.', type: 'success' });
            } else {
                addToast({ message: '❌ Failed to start stock take session.', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to start stock take:', error);
            addToast({ message: '❌ Error starting stock take session.', type: 'error' });
        }
    };

    const handleEnd = async () => {
        try {
            if (!activeSession?.id) {
                addToast({ message: '❌ No active session to end.', type: 'error' });
                return;
            }

            // First, get the session data before ending it
            const sessionSummary = await getSessionSummary();
            console.log('📋 Session summary before ending:', sessionSummary);
            
            const success = await endRealtimeSession(activeSession.id);
            if (success) {
                setPhase('review');
                
                // Create discrepancy report from session data
                if (sessionSummary && sessionSummary.scannedItemsArray && sessionSummary.scannedItemsArray.length > 0) {
                    console.log('📋 Creating discrepancy report from session data:', sessionSummary.scannedItemsArray.length, 'items');
                    
                    const report = sessionSummary.scannedItemsArray.map((scannedItem: any) => ({
                        id: scannedItem.itemId,
                        sku: scannedItem.sku || scannedItem.itemId,
                        name: scannedItem.itemName,
                        expectedStock: scannedItem.expectedQuantity,
                        countedStock: scannedItem.scannedQuantity,
                        discrepancy: scannedItem.variance || (scannedItem.scannedQuantity - scannedItem.expectedQuantity),
                        scannedAt: scannedItem.scannedAt,
                        scannedDate: new Date(scannedItem.scannedAt).toISOString().split('T')[0],
                        scannedTime: new Date(scannedItem.scannedAt).toLocaleTimeString()
                    }));
                    
                    setDiscrepancyReport(report);
                    console.log('📋 Discrepancy report created:', report.length, 'items');
                } else {
                    console.log('📋 No session data found, creating report from inventory');
                    // Fallback: Create report showing all inventory as unchanged
                    const report = inventory.map(item => ({
                        id: item.id,
                        sku: item.sku,
                        name: item.name,
                        expectedStock: item.stock,
                        countedStock: item.stock, // Default to current stock
                        discrepancy: 0, // No changes since no session data
                        scannedAt: Date.now(),
                        scannedDate: new Date().toISOString().split('T')[0],
                        scannedTime: new Date().toLocaleTimeString()
                    }));
                    setDiscrepancyReport(report);
                }

                // Removed duplicate ADD_LOG - realtimeNotificationService handles notifications  
                addToast({ message: '✅ Stock take session completed! Report generated from real-time data.', type: 'success' });
            } else {
                addToast({ message: '❌ Failed to end stock take session.', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to end stock take:', error);
            addToast({ message: '❌ Error ending stock take session.', type: 'error' });
        }
    };

    const handleCountedStockChange = (itemId: string, newCount: number) => {
        setDiscrepancyReport(prevReport =>
            prevReport.map(item => {
                if (item.id === itemId) {
                    return {
                        ...item,
                        countedStock: newCount,
                        discrepancy: newCount - item.expectedStock,
                    };
                }
                return item;
            })
        );
    };

    const handleApplyChanges = async () => {
        const itemsWithDiscrepancy = discrepancyReport.filter(item => item.discrepancy !== 0);
        if (itemsWithDiscrepancy.length === 0) {
            addToast({ message: 'No discrepancies to sync.', type: 'info' });
            return;
        }
        setIsSubmitting(true);
        
        try {
            const isZohoConnected = state.currentOrganization?.integrations?.zoho?.status === 'connected';
            
            // If Zoho is connected, create approval requests for stock take amendments
            if (isZohoConnected) {
                const { createApprovalRequest } = await import('../services/apiService');
                
                // Generate a unique session identifier for this stock take batch
                const stockTakeSessionId = `stocktake_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const sessionTimestamp = new Date().toISOString();
                
                // Create approval requests for each discrepancy with session tracking
                const approvalPromises = itemsWithDiscrepancy.map(async (item) => {
                    const quantityDelta = item.discrepancy;
                    return createApprovalRequest(state.currentOrganization.id, {
                        type: 'zoho_sync',
                        action: 'adjust_stock',
                        itemId: item.id,
                        itemName: item.name,
                        itemSKU: item.sku,
                        requestedBy: state.currentUser.uid || state.currentUser.email,
                        requestedByName: state.currentUser.name || state.currentUser.email,
                        requestedChange: {
                            quantityDelta,
                            newQuantity: item.countedStock,
                            reason: 'Stock take adjustment'
                        },
                        source: 'dashboard',
                        stockTakeSessionId,
                        stockTakeSessionTimestamp: sessionTimestamp,
                        stockTakeItemCount: itemsWithDiscrepancy.length
                    });
                });
                
                await Promise.all(approvalPromises);
                
                addToast({ 
                    message: `${itemsWithDiscrepancy.length} stock take change(s) sent for approval. Changes will sync to Zoho after approval.`, 
                    type: 'info' 
                });
                
                dispatch({ type: 'ADD_LOG', payload: { 
                    user: state.currentUser.email, 
                    action: `Requested approval: ${itemsWithDiscrepancy.length} stock take amendments pending approval.` 
                } });
                
            } else {
                // No Zoho connection - apply changes directly
                const updatePromises = itemsWithDiscrepancy.map(item => {
                    const originalItem = inventory.find(i => i.id === item.id);
                    if (!originalItem) return Promise.resolve();
                    return handleUpdateItem({ ...originalItem, stock: item.countedStock });
                });
                await Promise.all(updatePromises);
                
                addToast({ message: `Successfully updated ${itemsWithDiscrepancy.length} item(s).`, type: 'success' });
                dispatch({ type: 'ADD_LOG', payload: { 
                    user: state.currentUser.email, 
                    action: `Applied ${itemsWithDiscrepancy.length} stock take changes.` 
                } });
            }
        } catch (error) {
            console.error('Error applying stock take changes:', error);
            addToast({ message: 'An error occurred while applying changes.', type: 'error' });
        } finally {
            setIsSubmitting(false);
            setPhase('idle');
        }
    };

    const handleExport = () => {
        const headers = "SKU,Name,Expected Stock,Counted Stock,Discrepancy,Date,Time\n";
        const csvContent = discrepancyReport.map(item =>
            `${item.sku},"${item.name}",${item.expectedStock},${item.countedStock},${item.discrepancy},${item.scannedDate || ''},${item.scannedTime || ''}`
        ).join("\n");
        const blob = new Blob([headers + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        link.setAttribute("download", `stock_take_report_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        addToast({ message: 'Report exported successfully!', type: 'success' });
    };
    
    const handleFinishReview = () => {
        setPhase('idle');
        // No simulated progress items to clear after removal
        setDiscrepancyReport([]);
    }

    const itemsToApplyCount = useMemo(() => {
        if (!Array.isArray(discrepancyReport)) return 0;
        return discrepancyReport.filter(item => item.discrepancy !== 0).length;
    }, [discrepancyReport]);

    if (phase === 'idle') {
        return (
            <div className="text-center bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg flex flex-col items-center">
                {/* Session Restoration Banner */}
                {activeSession && (
                    <div className="mb-6 w-full p-4 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg text-left">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 bg-amber-500 rounded-full animate-pulse"></div>
                                    <span className="font-semibold text-amber-800 dark:text-amber-300">
                                        📋 Session Restored: Stock Take Active
                                    </span>
                                </div>
                                <div className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                                    Found active session: {activeSession.id} | Started by: {activeSession.startedBy} |
                                    Duration: {Math.floor((Date.now() - activeSession.startTime) / 60000)} minutes
                                </div>
                                <div className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                                    🔄 Session persisted across page refresh. APK devices are still connected.
                                </div>
                            </div>
                            <button
                                onClick={() => setPhase('in_progress')}
                                className="px-3 py-1 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors text-sm"
                            >
                                Resume Session
                            </button>
                        </div>
                    </div>
                )}
                
                 <ClipboardIcon />
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-4">Stock Take Control</h1>
                <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-md">
                    {activeSession 
                        ? "A stock take session is currently active. Resume to continue monitoring progress or start a new session."
                        : "Start a new session to enable stock counting on connected mobile devices. The dashboard will monitor progress in real-time."
                    }
                </p>
                
                {/* Debug Section */}
                <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                    <h3 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">🧪 Debug Real-Time System</h3>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
                        Notifications received: {notifications.length} | Active session: {activeSession ? 'Yes' : 'No'}
                    </p>
                    <button
                        onClick={sendTestNotification}
                        className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors text-sm"
                    >
                        Send Test Notification
                    </button>
                </div>
                
                <button
                    onClick={handleStart}
                    className="mt-6 flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 transition-colors shadow-md"
                >
                    <StartIcon />
                    Start New Stock Take Session
                </button>
            </div>
        );
    }

    if (phase === 'in_progress') {
        return (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                {/* Active Session Banner */}
                {activeSession && (
                    <div className="mb-4 p-4 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                                <span className="font-semibold text-green-800 dark:text-green-300">
                                    🟢 LIVE SESSION: Stock Take in Progress
                                </span>
                            </div>
                            <div className="font-mono text-lg text-green-800 dark:text-green-200 bg-green-200 dark:bg-green-800/50 px-2 py-1 rounded-md">
                                {liveTime}
                            </div>
                        </div>
                        <div className="mt-2 text-sm text-green-700 dark:text-green-400">
                            Session ID: {activeSession.id} | Started by: {activeSession.startedBy} | 
                            APK notifications: ✅ Active
                        </div>
                        <div className="mt-1 text-xs text-green-600 dark:text-green-500">
                            📱 All APK devices have been notified and can join this session
                        </div>
                    </div>
                )}

                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Stock Take in Progress...</h1>
                        {activeSession && (
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Session: {activeSession.id} • Started by: {activeSession.startedBy}
                            </p>
                        )}
                    </div>
                    {state.currentUser.role === 'Admin' && (
                        <button onClick={handleEnd} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-md hover:bg-red-700 transition-colors">
                            <StopIcon />
                            End Session & Review
                        </button>
                    )}
                    {state.currentUser.role !== 'Admin' && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-400 text-white font-semibold rounded-md cursor-not-allowed opacity-60" title="Admin access required">
                            <StopIcon />
                            End Session (Admin Only)
                        </div>
                    )}
                </div>
                
                {/* Real-time session stats */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {activeSession ? Object.keys(activeSession.scannedItems || {}).length : 0}
                        </div>
                        <div className="text-sm text-blue-600 dark:text-blue-400">Items Scanned</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                            {activeSession ? activeSession.participantDevices.length : 0}
                        </div>
                        <div className="text-sm text-green-600 dark:text-green-400">Active Devices</div>
                    </div>
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                            {liveTime}
                        </div>
                        <div className="text-sm text-yellow-600 dark:text-yellow-400">Time Elapsed</div>
                    </div>
                </div>
                
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                    Live feed from mobile scanners. Real-time scanned items will appear below.
                </p>
                <div className="overflow-y-auto max-h-[65vh]">
                    <table className="w-full text-sm text-left text-gray-600 dark:text-gray-400">
                         <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-gray-700 sticky top-0">
                            <tr>
                                <th scope="col" className="px-6 py-3">Time</th>
                                <th scope="col" className="px-6 py-3">Item Name</th>
                                <th scope="col" className="px-6 py-3">SKU</th>
                                <th scope="col" className="px-6 py-3 text-center">Counted Qty</th>
                                <th scope="col" className="px-6 py-3">Counted By</th>
                                <th scope="col" className="px-6 py-3">Source</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(!activeSession?.scannedItems || Object.keys(activeSession.scannedItems).length === 0) ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-16 text-gray-500">
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-indigo-500"></div>
                                            Waiting for first count from mobile app...
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <>
                                    {/* Real-time scanned items from active session */}
                                    {activeSession?.scannedItems && Object.entries(activeSession.scannedItems)
                                        .sort(([, a], [, b]) => b.scannedAt - a.scannedAt)
                                        .map(([itemId, scanData]) => (
                                        <tr key={`realtime-${itemId}-${scanData.scannedAt}`} className="bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800">
                                            <td className="px-6 py-4 font-medium">
                                                {new Date(scanData.scannedAt).toLocaleTimeString()}
                                            </td>
                                            <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">
                                                {scanData.itemName || `Item ${itemId}`}
                                            </td>
                                            <td className="px-6 py-4">{scanData.sku || itemId}</td>
                                            <td className="px-6 py-4 text-center font-bold text-green-600 dark:text-green-400">
                                                {scanData.scannedQuantity}
                                            </td>
                                            <td className="px-6 py-4">{scanData.scannedBy}</td>
                                            <td className="px-6 py-4">
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                                    🔴 Live
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    
                                    {/* No legacy simulated progress items - only live data shown */}
                                </>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (phase === 'review') {
        return (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                 <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Stock Take Review</h1>
                 <p className="text-gray-600 dark:text-gray-400 mb-4">Review the discrepancies found during the count. Apply changes to update your inventory records.</p>
                 <div className="flex justify-between items-center mb-4">
                     <button onClick={handleFinishReview} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white font-semibold rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
                        Cancel
                    </button>
                    <div className="flex items-center gap-4">
                        <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 transition-colors">
                            <ExportIcon />
                            Export Report
                        </button>
                        <button onClick={handleApplyChanges} disabled={isSubmitting || itemsToApplyCount === 0} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:bg-indigo-800 disabled:cursor-not-allowed transition-colors">
                            <SyncIcon />
                            {isSubmitting ? 'Applying...' : `Apply ${itemsToApplyCount} Changes`}
                        </button>
                    </div>
                 </div>
                 <div className="overflow-y-auto max-h-[65vh]">
                    <table className="w-full text-sm text-left text-gray-600 dark:text-gray-400">
                        <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-gray-700 sticky top-0">
                            <tr>
                                <th scope="col" className="px-6 py-3">SKU</th>
                                <th scope="col" className="px-6 py-3">Name</th>
                                <th scope="col" className="px-6 py-3 text-center">Expected Stock</th>
                                <th scope="col" className="px-6 py-3 text-center">Counted Stock</th>
                                <th scope="col" className="px-6 py-3 text-center">Discrepancy</th>
                            </tr>
                        </thead>
                        <tbody>
                            {discrepancyReport.length === 0 ? (
                                <tr><td colSpan={5} className="text-center py-16 text-gray-500">No items in inventory to review.</td></tr>
                            ) : discrepancyReport.map(item => (
                                <tr key={item.id} className={`border-b border-gray-200 dark:border-gray-700 ${item.discrepancy !== 0 ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-white dark:bg-gray-800'}`}>
                                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">{item.sku}</td>
                                    <td className="px-6 py-4">{item.name}</td>
                                    <td className="px-6 py-4 text-center">{item.expectedStock}</td>
                                    <td className="px-6 py-4 text-center">
                                        <input
                                            type="number"
                                            value={item.countedStock}
                                            onChange={(e) => handleCountedStockChange(item.id, parseInt(e.target.value, 10) || 0)}
                                            className="w-20 text-center bg-transparent dark:bg-gray-700/50 rounded-md border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </td>
                                    <td className={`px-6 py-4 text-center font-bold ${item.discrepancy > 0 ? 'text-green-500' : item.discrepancy < 0 ? 'text-red-500' : ''}`}>
                                        {item.discrepancy > 0 ? `+${item.discrepancy}` : item.discrepancy}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                 </div>
            </div>

            {/* Debug Section - Shows all sessions */}
            <div className="bg-gray-50 p-4 rounded-lg mt-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4">
                    🔍 Debug: All Stock Take Sessions ({allSessions.length})
                </h3>
                {allSessions.length > 0 ? (
                    <div className="space-y-2">
                        {allSessions.slice(0, 5).map((session) => (
                            <div key={session.id} className="bg-white p-3 rounded border">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <strong>{session.id}</strong>
                                        <span className={`ml-2 px-2 py-1 text-xs rounded ${
                                            session.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                                            session.status === 'COMPLETED' ? 'bg-blue-100 text-blue-800' :
                                            'bg-gray-100 text-gray-800'
                                        }`}>
                                            {session.status}
                                        </span>
                                    </div>
                                    <div className="text-sm text-gray-600">
                                        Items: {session.itemsScanned || 0}
                                    </div>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    User: {session.userName} | Device: {session.deviceId} | 
                                    Start: {new Date(session.startTime).toLocaleString()}
                                </div>
                            </div>
                        ))}
                        {allSessions.length > 5 && (
                            <div className="text-sm text-gray-600 text-center">
                                ... and {allSessions.length - 5} more sessions
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-gray-600 text-center py-4">
                        No stock take sessions found. Try syncing from the APK.
                    </div>
                )}
            </div>
        );
    }

    return null;
};

export default StockTakeView;

import React, { useState, useMemo } from 'react';
import type { ActivityLogEntry } from '../types';
import { useAppContext } from '../context/AppContext';

interface ActivityLogProps {
  logs: ActivityLogEntry[];
}

const ActivityLog: React.FC<ActivityLogProps> = ({ logs }) => {
  const { state } = useAppContext();
  // Default to show all logs to avoid confusion that older logs disappeared
  const [showAllLogs, setShowAllLogs] = useState(true);
  
  // Helper function to get actual username from userId
  const getUserDisplayName = (userId: string | undefined): string => {
    if (!userId) return 'Unknown User';
    
    // Look up the user in the users array to get their actual name
    const user = state.users.find(u => u.uid === userId);
    if (user) {
        return user.name || user.email?.split('@')[0] || 'Unknown User';
    }
    
    // If not found in users, extract from email if possible
    if (userId && userId.includes('@')) {
        return userId.split('@')[0];
    }

    // Fallback to shortened userId
    if (!userId) return 'Unknown User';
    return userId.length > 10 ? userId.substring(0, 8) : userId;
  };
  
  // Filter out archived logs from UI display
  const activeLogs = useMemo(() => {
    return logs.filter(log => !log.archived);
  }, [logs]);

  // Separate dashboard logs from APK logs with better detection
  const { dashboardLogs, apkLogs } = useMemo(() => {
    const dashboard: ActivityLogEntry[] = [];
    const apk: ActivityLogEntry[] = [];
    
    console.log('🔍 Analyzing logs for APK detection:', activeLogs.length);
    
    activeLogs.forEach(log => {
      // Multiple ways to detect APK logs
      const isApkLog = (
        // Check for realtime ID prefix (in-memory APK logs)
        log.id?.startsWith('rt_') ||
        // Check for APK source in metadata (persisted APK logs)
        (typeof log.details === 'object' && 
         ((log.details as any)?.metadata?.importSource?.includes('apk') ||
          (log.details as any)?.metadata?.importSource?.includes('realtime'))) ||
        // Check for user ID patterns (long UIDs vs emails - APK users)
        (log.user && log.user.length > 20 && !log.user.includes('@') && !log.user.includes(' ')) ||
        // Check for specific APK actions
        log.action?.includes('Stock Out:') ||
        log.action?.includes('Stock In:') ||
        // Check if action mentions "units" (typical APK pattern)
        log.action?.includes('units') ||
        // Check for source field indicating APK
        (log as any)?.source === 'apk'
      );
      
      if (isApkLog) {
        console.log('📱 APK log detected:', log.action, log.user);
        // For APK logs, get actual username from userId lookup
        const actualUsername = log.userName || log.user || getUserDisplayName((log as any).userId);
        const enhancedApkLog = {
          ...log,
          user: actualUsername,
          userName: actualUsername
        };
        apk.push(enhancedApkLog);
      } else {
        console.log('🖥️ Dashboard log:', log.action, log.user);
        dashboard.push(log);
      }
    });
    
    console.log(`📊 Split complete: ${dashboard.length} dashboard, ${apk.length} APK logs`);
    
    // Sort both by timestamp, newest first
    dashboard.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    apk.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return { dashboardLogs: dashboard, apkLogs: apk };
  }, [activeLogs]);
  
  // Filter dashboard logs based on 2-hour threshold
  const { recentDashboardLogs, hiddenDashboardCount } = useMemo(() => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const recent = dashboardLogs.filter(log => {
      const logDate = new Date(log.timestamp);
      return logDate > twoHoursAgo;
    });
    
    return {
      recentDashboardLogs: recent,
      hiddenDashboardCount: dashboardLogs.length - recent.length
    };
  }, [dashboardLogs]);
  
  // Determine which dashboard logs to display
  const displayDashboardLogs = showAllLogs ? dashboardLogs : recentDashboardLogs;
  
  const formatTimestamp = (timestamp: string | Date) => {
    let date: Date | null = null;
    try {
      if (timestamp instanceof Date) {
        date = timestamp;
      } else if (typeof timestamp === 'string') {
        // Try to parse ISO or fallback
        const d = new Date(timestamp);
        if (!isNaN(d.getTime())) date = d;
      }
      if (!date) {
        // Attempt Firestore Timestamp-like object support
        const anyTs: any = timestamp as any;
        if (anyTs && typeof anyTs.toDate === 'function') {
          date = anyTs.toDate();
        }
      }
    } catch {}

    if (!date || isNaN(date.getTime())) {
      return 'Unknown time';
    }

    // Format as relative time for recent logs
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMinutes < 60) {
      return diffMinutes <= 1 ? 'Just now' : `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  const formatDetails = (details: string | object, log?: ActivityLogEntry): string => {
    if (!details && (!log?.detailsStructured && !log?.auditTrail)) {
      return 'No additional details';
    }
    
    const parts: string[] = [];
    
    // Handle enhanced audit trail first (new format)
    if (log?.auditTrail) {
      console.log('🔍 Processing audit trail:', log.auditTrail);
      const audit = log.auditTrail as any;
      if (audit.description && audit.description !== 'No description provided') {
        parts.push(audit.description);
      }
    }
    
    // Handle enhanced structured details 
    if (log?.detailsStructured) {
      const structured = log.detailsStructured as any;
      if (structured.description && structured.description !== 'No description provided') {
        parts.push(structured.description);
      }
      if (structured.itemAffected && structured.itemAffected !== 'N/A') {
        parts.push(`Item: ${structured.itemAffected}`);
      }
      if (structured.metadata?.sessionId) {
        parts.push(`Session: ${structured.metadata.sessionId}`);
      }
      if (structured.metadata?.itemsScanned) {
        parts.push(`Items: ${structured.metadata.itemsScanned}`);
      }
      if (structured.metadata?.source) {
        parts.push(`Source: ${structured.metadata.source}`);
      }
    }
    
    // Handle object details (enhanced structure)
    if (typeof details === 'object' && details) {
      const detailsObj = details as any;
      
      // Show item name if available
      if (detailsObj.itemName) {
        parts.push(`Item: ${detailsObj.itemName}`);
      }
      
      // Show stock change cleanly
      if (detailsObj.change && detailsObj.change.field === 'stock') {
        const change = detailsObj.change;
        if (change.from === 'N/A' || change.from === 'unknown' || !change.from) {
          parts.push(`Stock: ${change.to}`);
        } else {
          parts.push(`Stock: ${change.from} → ${change.to}`);
        }
      } else if (detailsObj.change) {
        const change = detailsObj.change;
        parts.push(`${change.field}: ${change.from} → ${change.to}`);
      }
      
      // Show source for real-time entries
      if (detailsObj.metadata?.importSource && detailsObj.metadata.importSource.includes('realtime')) {
        const source = detailsObj.metadata.importSource.replace('_realtime', '');
        parts.push(`Source: ${source}`);
      }
      
      // Show other metadata
      if (detailsObj.metadata) {
        if (detailsObj.metadata.batchSize) {
          parts.push(`Batch: ${detailsObj.metadata.batchSize} items`);
        }
        if (detailsObj.metadata.duplicatesOverwritten) {
          parts.push(`Duplicates: ${detailsObj.metadata.duplicatesOverwritten}`);
        }
      }
    }
    
    // Handle string details (legacy format)
    if (typeof details === 'string' && details) {
      if (details.trim() === '') {
        return parts.length > 0 ? parts.join(' | ') : 'No additional details';
      }
      
      // Try to parse JSON details
      try {
        const parsed = JSON.parse(details);
        if (parsed.fileName) {
          parts.push(`File: ${parsed.fileName}`);
        }
        if (parsed.count !== undefined) {
          parts.push(`Items: ${parsed.count}`);
        }
        if (typeof parsed === 'string') {
          parts.push(parsed);
        }
      } catch {
        parts.push(details);
      }
    }
    
    return parts.length > 0 ? parts.join(' | ') : 'No additional details';
  };

  // Resolve a friendly user display using organization state and enhanced audit trail
  const resolveUserDisplay = (log: ActivityLogEntry) => {
    // First try enhanced audit trail
    if (log.auditTrail?.userName && log.auditTrail.userName !== 'System User') {
      return log.auditTrail.userName;
    }
    if (log.auditTrail?.userEmail && log.auditTrail.userEmail !== 'system@stockflow.com') {
      const emailUser = state.users.find(u => u.email.toLowerCase() === log.auditTrail!.userEmail!.toLowerCase());
      return emailUser?.name || log.auditTrail.userEmail;
    }
    
    // Try structured fields
    if (log.actionBy && log.actionBy !== 'Unknown User') {
      return log.actionBy;
    }
    if (log.userEmail) {
      const emailUser = state.users.find(u => u.email.toLowerCase() === log.userEmail!.toLowerCase());
      return emailUser?.name || log.userEmail;
    }
    
    // Try legacy user field
    const raw = log.user;
    if (raw && raw.includes('@')) {
      // Try to match by email for a nicer display (name if present)
      const u = state.users.find(u => u.email.toLowerCase() === raw.toLowerCase());
      return u?.name || raw;
    }
    // Try to match by UID
    if (raw) {
      const u = state.users.find(u => u.uid === raw);
      if (u) return u.name || u.email;
    }
    // Fallback to raw or placeholder
    return raw || 'Unknown user';
  };

  const parseDate = (timestamp: string | Date): Date | null => {
    try {
      if (timestamp instanceof Date) return timestamp;
      if (typeof timestamp === 'string') {
        const d = new Date(timestamp);
        if (!isNaN(d.getTime())) return d;
      }
      const anyTs: any = timestamp as any;
      if (anyTs && typeof anyTs.toDate === 'function') return anyTs.toDate();
    } catch {}
    return null;
  };

  const formatActionWithDetails = (log: ActivityLogEntry): string => {
    const baseAction = log.action;
    
    // Access details properly
    const details = log.details;
    
    // Add item details if available in details object
    if (details && typeof details === 'object') {
      const detailsObj = details as any;
      
      if (detailsObj.itemSku && detailsObj.itemName) {
        switch (log.action) {
          case 'Add Item':
            return `Added "${detailsObj.itemName}" (${detailsObj.itemSku})`;
          case 'Update Item':
            return `Updated "${detailsObj.itemName}" (${detailsObj.itemSku})`;
          case 'Delete Item':
            return `Deleted "${detailsObj.itemName}" (${detailsObj.itemSku})`;
          case 'Stock Update':
            return `Stock updated for "${detailsObj.itemName}" (${detailsObj.itemSku})`;
          case 'Low Stock Alert':
            return `Low stock alert for "${detailsObj.itemName}" (${detailsObj.itemSku})`;
          default:
            return `${baseAction} - "${detailsObj.itemName}" (${detailsObj.itemSku})`;
        }
      }

      // Add import/export details
      if (detailsObj.metadata) {
        const metadata = detailsObj.metadata;
        if (metadata.importSource && log.action === 'Import CSV') {
          return `Imported CSV from ${metadata.importSource}`;
        }
        if (metadata.batchSize && log.action === 'Bulk Import') {
          return `Bulk import: ${metadata.batchSize} items`;
        }
      }
    }

    // Enhanced action descriptions
    switch (log.action) {
      case 'Login':
        return 'User logged in';
      case 'Logout':
        return 'User logged out';
      case 'Zoho Sync':
        return 'Synchronized with Zoho Inventory';
      case 'Settings Update':
        return 'Updated application settings';
      case 'User Management':
        return 'Modified user permissions';
      case 'Barcode Scan':
        return 'Scanned item barcode';
      case 'Stock Take':
        return 'Performed stock take';
      case 'Generate Report':
        return 'Generated inventory report';
      default:
        return baseAction;
    }
  };

  // Format APK activity details cleanly
  const formatApkDetails = (log: ActivityLogEntry): string => {
    const details = log.details;
    const logData = log as any; // Access APK-specific fields
    const parts: string[] = [];
    
    // Handle APK-specific fields (itemName, quantity, etc.)
    if (logData.itemName) {
      parts.push(`Item: ${logData.itemName}`);
    }
    
    if (logData.quantity !== undefined && logData.quantity !== null) {
      const quantity = Math.abs(logData.quantity);
      const action = logData.quantity < 0 ? 'Removed' : 'Added';
      parts.push(`${action}: ${quantity} units`);
    }
    
    // Handle structured details object
    if (details && typeof details === 'object') {
      const detailsObj = details as any;
      
      if (detailsObj.itemName && !logData.itemName) {
        parts.push(`Item: ${detailsObj.itemName}`);
      }
      
      if (detailsObj.change && detailsObj.change.field === 'stock') {
        parts.push(`New Stock: ${detailsObj.change.to}`);
      }
    }
    
    // If we have source information, show it
    if (logData.source === 'apk') {
      parts.push('Source: Mobile App');
    }
    
    return parts.length > 0 ? parts.join(' | ') : 'Mobile activity';
  };

  return (
    <div className="space-y-6">
      {/* Dashboard Activity Log */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-200">🖥️ Dashboard Activity Log</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {showAllLogs 
                ? `Showing all ${dashboardLogs.length} dashboard entries`
                : `Showing ${recentDashboardLogs.length} recent entries (last 2 hours)`
              }
            </p>
          </div>
          
          {hiddenDashboardCount > 0 && (
            <button
              onClick={() => setShowAllLogs(!showAllLogs)}
              className="px-4 py-2 text-sm font-medium bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-md hover:bg-indigo-200 dark:hover:bg-indigo-900 transition-colors flex items-center gap-2"
            >
              {showAllLogs ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Show Recent Only
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Show All ({hiddenDashboardCount} hidden)
                </>
              )}
            </button>
          )}
        </div>
        
        {!showAllLogs && hiddenDashboardCount > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <p className="text-sm text-blue-700 dark:text-blue-400">
                📝 {hiddenDashboardCount} older dashboard entries are hidden.
              </p>
            </div>
          </div>
        )}
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600 dark:text-gray-400">
            <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-gray-700">
              <tr>
                <th scope="col" className="px-6 py-3">Timestamp</th>
                <th scope="col" className="px-6 py-3">User & Session</th>
                <th scope="col" className="px-6 py-3">Action</th>
                <th scope="col" className="px-6 py-3">Audit Details</th>
              </tr>
            </thead>
            <tbody>
              {displayDashboardLogs.length > 0 ? (
                displayDashboardLogs.map((log, index) => {
                  const isOld = !showAllLogs ? false : new Date(log.timestamp) <= new Date(Date.now() - 2 * 60 * 60 * 1000);
                  return (
                    <tr 
                      key={log.id} 
                      className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                        isOld ? 'opacity-60' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {formatTimestamp(log.timestamp)}
                          </span>
                          {showAllLogs && (() => {
                            const exact = parseDate(log.timestamp);
                            return (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {exact ? exact.toLocaleString() : '-'}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {resolveUserDisplay(log)}
                          </span>
                          {/* Show additional user context for audit trail */}
                          {log.auditTrail?.userEmail && log.auditTrail.userEmail !== resolveUserDisplay(log) && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {log.auditTrail.userEmail}
                            </span>
                          )}
                          {log.auditTrail?.sessionId && (
                            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                              Session: {log.auditTrail.sessionId.slice(0, 8)}...
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-700 text-blue-800 dark:text-blue-200">
                          {formatActionWithDetails(log)}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <div className="flex flex-col space-y-1">
                          <span className="text-gray-600 dark:text-gray-400 text-sm break-words" title={formatDetails(log.details, log)}>
                            {formatDetails(log.details, log)}
                          </span>
                          {/* Show audit trail context */}
                          {log.auditTrail?.source && (
                            <span className="text-xs text-blue-500 dark:text-blue-400">
                              📱 Source: {log.auditTrail.source}
                            </span>
                          )}
                          {log.auditTrail?.timestamp && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              🕒 {new Date(log.auditTrail.timestamp).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex flex-col items-center space-y-2">
                      <div className="text-4xl">�️</div>
                      <p className="font-medium">No dashboard activity found</p>
                      <p className="text-sm">Web dashboard actions will appear here</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* APK Activity Log - Always show if any APK logs exist */}
      {apkLogs.length > 0 && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg border-l-4 border-l-green-500">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-200">📱 Mobile App Activity</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Real-time updates from mobile devices ({apkLogs.length} entries)
              </p>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-600 dark:text-gray-400">
              <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-green-50 dark:bg-green-900/20">
                <tr>
                  <th scope="col" className="px-6 py-3">Time</th>
                  <th scope="col" className="px-6 py-3">User</th>
                  <th scope="col" className="px-6 py-3">Action</th>
                  <th scope="col" className="px-6 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {apkLogs.map((log, index) => (
                  <tr 
                    key={log.id} 
                    className="border-b border-gray-200 dark:border-gray-700 hover:bg-green-50 dark:hover:bg-green-900/10 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {formatTimestamp(log.timestamp)}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          📱 Mobile
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {resolveUserDisplay(log)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-700 text-green-800 dark:text-green-200">
                        {formatActionWithDetails(log)}
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <span className="text-gray-600 dark:text-gray-400 truncate block" title={formatApkDetails(log)}>
                        {formatApkDetails(log)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Footer info */}
      <div className="text-center">
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <div>🔒 All activity records are permanently stored for audit purposes</div>
          <div>Dashboard: {dashboardLogs.length} • Mobile: {apkLogs.length} • Total: {logs.length}</div>
        </div>
      </div>
    </div>
  );
};

export default ActivityLog;

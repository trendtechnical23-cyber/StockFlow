import React, { useState, useEffect } from 'react';
import liveScanService, { LiveScanEvent, LiveScanState } from '../services/liveScanService';

interface LiveScanPanelProps {
  orgId: string;
}

const LiveScanPanel: React.FC<LiveScanPanelProps> = ({ orgId }) => {
  const [scanStates, setScanStates] = useState<Map<string, LiveScanState>>(new Map());
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    return liveScanService.subscribeToOrg(orgId, setScanStates);
  }, [orgId]);

  // Aggregate all scans across sessions
  const allScans: LiveScanEvent[] = [];
  const totalSkuCounts = new Map<string, number>();
  const totalUserCounts = new Map<string, number>();
  const allDuplicates = new Set<string>();

  scanStates.forEach((state) => {
    allScans.push(...state.scans);
    state.skuCounts.forEach((count, sku) => {
      totalSkuCounts.set(sku, (totalSkuCounts.get(sku) || 0) + count);
    });
    state.userScanCounts.forEach((count, user) => {
      totalUserCounts.set(user, (totalUserCounts.get(user) || 0) + count);
    });
    state.duplicateSkus.forEach(sku => allDuplicates.add(sku));
  });

  // Sort newest first
  allScans.sort((a, b) => {
    const aTime = a.scannedAt?.toMillis?.() || a.scannedAt || 0;
    const bTime = b.scannedAt?.toMillis?.() || b.scannedAt || 0;
    return bTime - aTime;
  });

  const totalScans = allScans.length;
  const totalSessions = scanStates.size;

  if (totalScans === 0 && totalSessions === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6">
      <div
        className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Live Scan Feed
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {totalScans} scan{totalScans !== 1 ? 's' : ''} across {totalSessions} session{totalSessions !== 1 ? 's' : ''}
          </span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="p-6">
          {/* User scan counts */}
          {totalUserCounts.size > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              {Array.from(totalUserCounts.entries()).map(([user, count]) => (
                <div key={user} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-full">
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{user}</span>
                  <span className="text-xs font-bold text-indigo-500 bg-indigo-100 dark:bg-indigo-800 px-1.5 py-0.5 rounded-full">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Scan event list */}
          <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
            {allScans.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 py-6">
                Waiting for scan events...
              </p>
            ) : (
              allScans.map((scan, idx) => {
                const isDuplicate = allDuplicates.has(scan.sku);
                const timestamp = scan.scannedAt?.toDate
                  ? scan.scannedAt.toDate()
                  : new Date(scan.scannedAt);
                const timeStr = !isNaN(timestamp.getTime())
                  ? timestamp.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : '';

                return (
                  <div
                    key={`${scan.sku}-${scan.deviceId}-${idx}`}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      isDuplicate
                        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                        : 'bg-gray-50 dark:bg-gray-700'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-white truncate">
                          {scan.itemName}
                        </p>
                        {isDuplicate && (
                          <span className="flex-shrink-0 text-xs font-bold text-red-600 bg-red-100 dark:bg-red-800 dark:text-red-300 px-1.5 py-0.5 rounded">
                            DUPLICATE
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {scan.sku} &middot; {scan.userName} &middot; Qty: {scan.scannedQuantity}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ml-3">
                      {timeStr}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveScanPanel;

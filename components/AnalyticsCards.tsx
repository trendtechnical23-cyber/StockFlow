import React, { useMemo, useEffect, useState } from 'react';
import { InventoryItem, ActivityLogEntry } from '../types';
import { calculateTotalValue } from '../utils/inventoryUtils';
import { useCounterAnimation } from '../hooks/useCounterAnimation';

interface AnalyticsCardsProps {
  inventory: InventoryItem[];
  activityLogs: ActivityLogEntry[];
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface AnalyticsData {
  inventoryTrends: {
    totalValue: number;
    valueChange: number;
    stockMovement: number;
    categoryDistribution: { [key: string]: number };
    topMovingItems: { name: string; movement: number; trend: 'up' | 'down' }[];
  };
  performanceMetrics: {
    itemsAdded: number;
    itemsUpdated: number;
    avgStockLevel: number;
    stockTurnover: number;
    criticalAlerts: number;
  };
  recentActivity: {
    totalActions: number;
    userActivity: { [user: string]: number };
    actionTypes: { [action: string]: number };
    hourlyActivity: number[];
  };
}

const TrendIcon: React.FC<{ trend: 'up' | 'down' | 'neutral' }> = ({ trend }) => {
  if (trend === 'up') {
    return <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>;
  } else if (trend === 'down') {
    return <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M16 18l2.29-2.29-4.88-4.88-4 4L2 7.41 3.41 6l6 6 4-4 6.3 6.29L22 12v6z"/></svg>;
  }
  return <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7v10c0 5.55 3.84 10 9 11 1.25-.35 2.27-.8 3.05-1.4C15.4 25.2 17.35 24 19 22.5c1.2-1.1 2.2-2.4 3-3.9C22.61 17.35 23 15.95 23 14.5V7L12 2z"/></svg>;
};

const AnalyticsCards: React.FC<AnalyticsCardsProps> = ({ 
  inventory, 
  activityLogs, 
  autoRefresh = false, 
  refreshInterval = 5 
}) => {
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isReady, setIsReady] = useState(false);

  // Auto-refresh logic
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      setLastRefresh(new Date());
    }, refreshInterval * 60 * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval]);

  const analyticsData: AnalyticsData = useMemo(() => {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Inventory trends
    const totalValue = calculateTotalValue(inventory);

    const categoryDistribution = inventory.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {} as { [key: string]: number });

    // Recent activity analysis
    const recentLogs = activityLogs.filter(log => {
      const logDate = new Date(log.timestamp);
      return logDate >= last24Hours;
    });

    const userActivity = recentLogs.reduce((acc, log) => {
      acc[log.user] = (acc[log.user] || 0) + 1;
      return acc;
    }, {} as { [user: string]: number });

    const actionTypes = recentLogs.reduce((acc, log) => {
      const actionType = log.action.split(' ')[0]; // Get first word of action
      acc[actionType] = (acc[actionType] || 0) + 1;
      return acc;
    }, {} as { [action: string]: number });

    // Hourly activity for the last 24 hours
    const hourlyActivity = Array(24).fill(0);
    recentLogs.forEach(log => {
      const hour = new Date(log.timestamp).getHours();
      hourlyActivity[hour]++;
    });

    // Performance metrics
    const criticalItems = inventory.filter(item => item.stock <= 0).length;
    const lowStockItems = inventory.filter(item => item.stock <= item.threshold && item.stock > 0).length;
    const avgStockLevel = inventory.length > 0 ? 
      inventory.reduce((sum, item) => sum + item.stock, 0) / inventory.length : 0;

    // Top moving items based on recent activity
    const itemActivityMap = new Map<string, number>();
    recentLogs.forEach(log => {
      if (typeof log.details === 'object' && log.details?.itemId) {
        const current = itemActivityMap.get(log.details.itemId) || 0;
        itemActivityMap.set(log.details.itemId, current + 1);
      }
    });

    const topMovingItems = Array.from(itemActivityMap.entries())
      .map(([itemId, activity]) => {
        const item = inventory.find(i => i.id === itemId);
        return item ? {
          name: item.name,
          movement: activity,
          trend: item.stock <= item.threshold ? 'down' as const : 'up' as const
        } : null;
      })
      .filter(Boolean)
      .slice(0, 5) as { name: string; movement: number; trend: 'up' | 'down' }[];

    return {
      inventoryTrends: {
        totalValue,
        valueChange: 0, // Would need historical data
        stockMovement: recentLogs.length,
        categoryDistribution,
        topMovingItems
      },
      performanceMetrics: {
        itemsAdded: actionTypes['Added'] || 0,
        itemsUpdated: actionTypes['Updated'] || 0,
        avgStockLevel: Math.round(avgStockLevel),
        // FIX BUG-DASH-002: Prevent division by zero
        stockTurnover: inventory.length > 0 ? Math.round((recentLogs.length / inventory.length) * 100) : 0,
        criticalAlerts: criticalItems + lowStockItems
      },
      recentActivity: {
        totalActions: recentLogs.length,
        userActivity,
        actionTypes,
        hourlyActivity
      }
    };
  }, [inventory, activityLogs, lastRefresh]);

  // Counter animations for each metric
  const { count: totalValueCount, isAnimating: totalValueAnimating } = useCounterAnimation({
    start: 0,
    end: analyticsData.inventoryTrends.totalValue,
    duration: 2500,
    delay: 100
  });

  const { count: activityCount, isAnimating: activityAnimating } = useCounterAnimation({
    start: 0,
    end: analyticsData.recentActivity.totalActions,
    duration: 1500,
    delay: 400
  });

  const { count: avgStockCount, isAnimating: avgStockAnimating } = useCounterAnimation({
    start: 0,
    end: analyticsData.performanceMetrics.avgStockLevel,
    duration: 2000,
    delay: 700
  });

  const { count: criticalAlertsCount, isAnimating: criticalAlertsAnimating } = useCounterAnimation({
    start: 0,
    end: analyticsData.performanceMetrics.criticalAlerts,
    duration: 1000,
    delay: 1000
  });

  useEffect(() => {
    // Small delay to ensure component is mounted before starting animations
    const timer = setTimeout(() => setIsReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const formatCurrency = (value: number) => {
    return `R${value.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
  };

  const getMostActiveUser = () => {
    const users = Object.entries(analyticsData.recentActivity.userActivity);
    if (users.length === 0) return 'No activity';
    return users.sort(([,a], [,b]) => b - a)[0][0];
  };

  const getPeakHour = () => {
    const maxActivity = Math.max(...analyticsData.recentActivity.hourlyActivity);
    const peakHour = analyticsData.recentActivity.hourlyActivity.indexOf(maxActivity);
    return `${peakHour}:00`;
  };

  return (
    <div className="space-y-6">
      {/* Header with auto-refresh status */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-200">
          Analytics Dashboard
        </h3>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          {autoRefresh && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Auto-refresh: {refreshInterval}min</span>
            </div>
          )}
          <span>Last updated: {lastRefresh.toLocaleTimeString()}</span>
        </div>
      </div>

      {/* Analytics Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Inventory Value */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:scale-105 hover:shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Value</p>
              <div className="flex items-center">
                <p className={`text-2xl font-bold transition-all duration-300 ${
                  totalValueAnimating ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'
                }`}>
                  {isReady ? formatCurrency(totalValueCount) : 'R0'}
                </p>
                {totalValueAnimating && (
                  <div className="ml-2 flex space-x-1">
                    <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></div>
                    <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                )}
              </div>
            </div>
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
              <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"></path>
              </svg>
            </div>
          </div>
        </div>

        {/* Stock Movement */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:scale-105 hover:shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">24h Activity</p>
              <div className="flex items-center">
                <p className={`text-2xl font-bold transition-all duration-300 ${
                  activityAnimating ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-gray-100'
                }`}>
                  {isReady ? activityCount.toLocaleString() : '0'}
                </p>
                {activityAnimating && (
                  <div className="ml-2 flex space-x-1">
                    <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse"></div>
                    <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">actions</p>
            </div>
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
              </svg>
            </div>
          </div>
        </div>

        {/* Average Stock Level */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:scale-105 hover:shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Avg Stock Level</p>
              <div className="flex items-center">
                <p className={`text-2xl font-bold transition-all duration-300 ${
                  avgStockAnimating ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-gray-100'
                }`}>
                  {isReady ? avgStockCount.toLocaleString() : '0'}
                </p>
                {avgStockAnimating && (
                  <div className="ml-2 flex space-x-1">
                    <div className="w-1 h-1 bg-yellow-500 rounded-full animate-pulse"></div>
                    <div className="w-1 h-1 bg-yellow-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1 h-1 bg-yellow-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">units per item</p>
            </div>
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900 rounded-full">
              <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
              </svg>
            </div>
          </div>
        </div>

        {/* Critical Alerts */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:scale-105 hover:shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Critical Alerts</p>
              <div className="flex items-center">
                <p className={`text-2xl font-bold transition-all duration-300 ${
                  criticalAlertsAnimating ? 'text-red-500 dark:text-red-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {isReady ? criticalAlertsCount.toLocaleString() : '0'}
                </p>
                {criticalAlertsAnimating && (
                  <div className="ml-2 flex space-x-1">
                    <div className="w-1 h-1 bg-red-500 rounded-full animate-pulse"></div>
                    <div className="w-1 h-1 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1 h-1 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">items need attention</p>
            </div>
            <div className="p-3 bg-red-100 dark:bg-red-900 rounded-full">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Distribution */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-200 mb-4">Category Distribution</h4>
          <div className="space-y-3">
            {Object.entries(analyticsData.inventoryTrends.categoryDistribution)
              .sort(([,a], [,b]) => b - a)
              .slice(0, 5)
              .map(([category, count]) => {
                const percentage = (count / inventory.length) * 100;
                return (
                  <div key={category} className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{category}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                      <span className="text-sm text-gray-600 dark:text-gray-400 w-12 text-right">
                        {count}
                      </span>
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>

        {/* Recent Activity Insights */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-200 mb-4">Activity Insights</h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Most Active User</span>
              <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                {getMostActiveUser()}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Peak Activity Hour</span>
              <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                {getPeakHour()}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Stock Turnover</span>
              <span className="text-sm text-purple-600 dark:text-purple-400 font-medium">
                {analyticsData.performanceMetrics.stockTurnover}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Moving Items */}
      {analyticsData.inventoryTrends.topMovingItems.length > 0 && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-200 mb-4">Most Active Items (24h)</h4>
          <div className="space-y-3">
            {analyticsData.inventoryTrends.topMovingItems.map((item, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center gap-3">
                  <TrendIcon trend={item.trend} />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {item.name}
                  </span>
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {item.movement} actions
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsCards;
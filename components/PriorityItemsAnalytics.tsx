import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { PriorityItem, InventoryItem } from '../types';

interface PriorityItemsAnalyticsProps {
  items: PriorityItem[];
  inventoryMap: Record<string, InventoryItem>;
}

const StatCard: React.FC<{ title: string; value: string | number; bgColor: string }> = ({ title, value, bgColor }) => (
  <div className={`p-4 rounded-lg shadow-md ${bgColor}`}>
    <h4 className="text-sm font-medium text-white uppercase tracking-wider">{title}</h4>
    <p className="text-3xl font-bold text-white">{value}</p>
  </div>
);

const PriorityItemsAnalytics: React.FC<PriorityItemsAnalyticsProps> = ({ items, inventoryMap }) => {
  const stockStatusCounts = items.reduce((acc, item) => {
    const invItem = inventoryMap[item.itemId];
    if (invItem) {
      if (invItem.stock <= invItem.threshold) {
        acc.below += 1;
      } else if (invItem.stock <= invItem.threshold * 1.2) {
        acc.near += 1;
      } else {
        acc.ok += 1;
      }
    }
    return acc;
  }, { below: 0, near: 0, ok: 0 });

  const lowStockItems = items
    .map(p => inventoryMap[p.itemId])
    .filter(item => item && item.stock <= item.threshold * 1.2)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 10);

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard title="Below Threshold" value={stockStatusCounts.below} bgColor="bg-red-500" />
        <StatCard title="Near Threshold" value={stockStatusCounts.near} bgColor="bg-yellow-500" />
        <StatCard title="Stock OK" value={stockStatusCounts.ok} bgColor="bg-green-500" />
      </div>
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
        <h3 className="font-semibold mb-2 text-gray-800 dark:text-gray-200">Items Nearing or Below Threshold</h3>
        <ResponsiveContainer width="100%" height={250}>
            {lowStockItems.length > 0 ? (
                <BarChart data={lowStockItems} layout="vertical" margin={{ top: 5, right: 20, left: 100, bottom: 5 }}>
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="stock">
                        {lowStockItems.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.stock <= entry.threshold ? '#EF4444' : '#F59E0B'} />
                        ))}
                    </Bar>
                </BarChart>
            ) : (
                <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500">All watched items have healthy stock levels.</p>
                </div>
            )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PriorityItemsAnalytics;
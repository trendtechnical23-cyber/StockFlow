import React from 'react';
import type { InventoryItem } from '../types';

interface InventoryTableProps {
  inventory: InventoryItem[];
  onItemClick: (item: InventoryItem) => void;
}

const InventoryTable: React.FC<InventoryTableProps> = ({ inventory, onItemClick }) => {
  return (
    <div className="overflow-x-auto h-full">
      <table className="w-full text-sm text-left text-gray-600 dark:text-gray-400">
        <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-gray-700 sticky top-0 z-10">
          <tr>
            <th scope="col" className="px-6 py-4 font-semibold">Name</th>
            <th scope="col" className="px-6 py-4 font-semibold">SKU</th>
            <th scope="col" className="px-6 py-4 text-center font-semibold">Stock on Hand</th>
            <th scope="col" className="px-6 py-4 text-right font-semibold">Cost Price</th>
            <th scope="col" className="px-6 py-4 text-right font-semibold">Selling Price</th>
            <th scope="col" className="px-6 py-4 font-semibold">Usage Unit</th>
          </tr>
        </thead>
        <tbody>
          {inventory.map(item => (
            <tr 
              key={item.id} 
              className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors duration-150" 
              onClick={() => onItemClick(item)}
            >
              <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">{item.description || item.name}</td>
              <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{item.sku}</td>
              <td className="px-6 py-4 text-center">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  item.stock < 0 
                    ? 'bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-300' 
                    : item.stock <= item.threshold 
                      ? 'bg-yellow-200 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' 
                      : 'bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-300'
                }`}>
                  {item.stock || 0}
                </span>
              </td>
              <td className="px-6 py-4 text-right font-medium text-gray-700 dark:text-gray-300">
                {item.cost ? `R${item.cost.toFixed(2)}` : '-'}
              </td>
              <td className="px-6 py-4 text-right font-medium text-gray-900 dark:text-gray-100">
                {item.price ? `R${item.price.toFixed(2)}` : '-'}
              </td>
              <td className="px-6 py-4">{item.unit || 'each'}</td>
            </tr>
          ))}
          {inventory.length === 0 && (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                <div className="flex flex-col items-center space-y-2">
                  <div className="text-lg">
                    <img src="/image/stockflow logo.png" alt="StockFlow" className="w-8 h-8 object-contain" />
                  </div>
                  <p className="font-medium">No items found</p>
                  <p className="text-sm">Try adjusting your search criteria or add a new item</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default InventoryTable;
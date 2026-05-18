import React, { useState, useEffect, useCallback } from 'react';
import type { InventoryItem, RestockSuggestion } from '../types';
import { getRestockSuggestions } from '../services/geminiService';

interface AiSuggestionsProps {
  lowStockItems: InventoryItem[];
}

const AiIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12 8V4H8"/><rect x="4" y="12" width="16" height="8" rx="2"/><path d="M2 12h2"/><path d="M20 12h2"/></svg>;
const CheckIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>;

const PriorityBadge: React.FC<{ priority: 'High' | 'Medium' | 'Low' }> = ({ priority }) => {
    const colorClasses = {
        High: 'bg-red-900 text-red-300',
        Medium: 'bg-yellow-900 text-yellow-300',
        Low: 'bg-blue-900 text-blue-300',
    };
    return (
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colorClasses[priority]}`}>
            {priority}
        </span>
    );
};

const AiSuggestions: React.FC<AiSuggestionsProps> = ({ lowStockItems }) => {
  const [suggestions, setSuggestions] = useState<RestockSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    console.log('🤖 AI Suggestions: Starting fetch with', lowStockItems.length, 'low stock items');
    
    if (lowStockItems.length === 0) {
      console.log('🤖 AI Suggestions: No low stock items, clearing suggestions');
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Log the items being sent for AI analysis
    console.log('🤖 AI Suggestions: Low stock items data:', lowStockItems.map(item => ({
      name: item.name,
      sku: item.sku,
      stock: item.stock,
      threshold: item.threshold,
      unit: item.unit
    })));

    setIsLoading(true);
    setError(null);
    try {
      const result = await getRestockSuggestions(lowStockItems);
      console.log('🤖 AI Suggestions: Received', result.length, 'suggestions:', result);
      setSuggestions(result);
    } catch (err: any) {
      console.error('🤖 AI Suggestions Error:', err);
      setError(err.message || 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [lowStockItems]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500"></div>
        </div>
      );
    }

    if (error && !error.includes('local algorithm')) {
      return (
        <div className="text-yellow-400 bg-yellow-900/30 p-3 rounded-md">
          <div className="mb-2 text-sm">
            <strong>AI Service Unavailable</strong><br />
            Using smart local algorithm for restock suggestions.
          </div>
          <button 
            onClick={fetchSuggestions}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition-colors"
          >
            Retry AI Service
          </button>
        </div>
      );
    }
    
    if (lowStockItems.length === 0) {
        return (
             <div className="text-center text-gray-400 flex flex-col items-center justify-center h-full">
                <CheckIcon />
                <p className="mt-2 font-semibold text-green-400">All stock levels are healthy!</p>
                <p className="text-sm text-gray-500">No restocking suggestions at this time.</p>
            </div>
        );
    }
    
    if (suggestions.length > 0) {
      return (
        <ul className="space-y-3">
          {suggestions.map((s, index) => (
            <li key={index} className="bg-gray-700 p-3 rounded-md">
              <div className="flex justify-between items-center">
                <p className="font-semibold text-gray-100">{s.name}</p>
                <PriorityBadge priority={s.priority} />
              </div>
              <p className="text-sm text-gray-400">SKU: {s.sku}</p>
              <p className="text-sm text-gray-300 mt-1">Suggested Reorder: <span className="font-bold text-indigo-400">{s.suggestedQuantity} {lowStockItems.find(item => item.sku === s.sku)?.unit || 'units'}</span></p>
            </li>
          ))}
        </ul>
      );
    }

    return (
        <div className="text-center text-gray-500 flex flex-col items-center justify-center h-full">
            <AiIcon />
            <p className="mt-2">Smart analysis complete - review your low stock items below.</p>
            <p className="text-xs text-gray-600 mt-1">Using intelligent algorithm for restock calculations</p>
        </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <AiIcon />
        <h3 className="text-xl font-semibold text-gray-200">Smart Restock Advisor</h3>
        {suggestions.length > 0 && (
          <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded-full ml-2">
            Smart Algorithm
          </span>
        )}
      </div>
      <div className="flex-grow overflow-y-auto pr-2">
        {renderContent()}
      </div>
    </div>
  );
};

export default AiSuggestions;
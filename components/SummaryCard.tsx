
import React, { useEffect, useState } from 'react';
import { useCounterAnimation } from '../hooks/useCounterAnimation';

interface SummaryCardProps {
  title: string;
  value: string | number;
  delay?: number;
  onClick?: () => void;
  clickable?: boolean;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ title, value, delay = 0, onClick, clickable = false }) => {
  const [isReady, setIsReady] = useState(false);
  
  // Convert value to number for animation, handle string values with commas
  const numericValue = typeof value === 'string' 
    ? parseInt(value.replace(/,/g, '')) || 0
    : value;
  
  const { count, isAnimating } = useCounterAnimation({
    start: 0,
    end: numericValue,
    duration: Math.min(2000 + (numericValue * 0.1), 4000), // Dynamic duration based on value, max 4s
    delay: delay
  });

  useEffect(() => {
    // Small delay to ensure component is mounted before starting animation
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Format the animated count for display
  const displayValue = isReady ? (
    typeof value === 'string' && value.includes(',')
      ? count.toLocaleString()
      : count.toString()
  ) : '0';

  return (
    <div 
      className={`relative bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm transition-all duration-200 ${
        clickable 
          ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]' 
          : 'hover:shadow-md'
      }`}
      onClick={clickable ? onClick : undefined}
    >
      {/* Subtle accent line at top */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-t-xl opacity-60" />
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">{title}</p>
      <div className="flex items-end gap-2">
        <p className={`text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white transition-all duration-300 ${isAnimating ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
          {displayValue}
        </p>
        {isAnimating && (
          <div className="mb-1.5 flex space-x-0.5">
            <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce"></div>
            <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
            <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SummaryCard;

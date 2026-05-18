
import React from 'react';

const WarningIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
)

interface LowStockAlertProps {
  count: number;
  onClose: () => void;
}

const LowStockAlert: React.FC<LowStockAlertProps> = ({ count, onClose }) => {
  return (
    <div className="bg-yellow-800 border-l-4 border-yellow-500 text-yellow-100 p-4 rounded-lg shadow-lg mb-6 flex items-center justify-between" role="alert">
      <div className="flex items-center">
        <WarningIcon />
        <div className="ml-3">
          <p className="font-bold">Low Stock Warning</p>
          <p className="text-sm">{count} items are running low. Please review and restock soon.</p>
        </div>
      </div>
      <button onClick={onClose} className="p-1 rounded-full hover:bg-yellow-700 transition-colors" aria-label="Dismiss">
        <CloseIcon />
      </button>
    </div>
  );
};

export default LowStockAlert;

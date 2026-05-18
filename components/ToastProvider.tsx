import React, { createContext, useState, useCallback, ReactNode } from 'react';
import { Toast } from '../types';

type ToastContextType = {
  addToast: (toast: Omit<Toast, 'id'>) => void;
};

export const ToastContext = createContext<ToastContextType | undefined>(undefined);

const ToastMessage: React.FC<{ toast: Toast, onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
    React.useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(toast.id);
        }, 5000);
        return () => clearTimeout(timer);
    }, [toast, onDismiss]);

    const baseClasses = 'flex items-center w-full max-w-xs p-4 my-2 text-gray-500 bg-white rounded-lg shadow-lg dark:text-gray-400 dark:bg-gray-800';
    const typeClasses = {
        success: 'dark:bg-green-800/50 backdrop-blur-sm',
        error: 'dark:bg-red-800/50 backdrop-blur-sm',
        info: 'dark:bg-blue-800/50 backdrop-blur-sm'
    };

    const Icon = () => {
        if(toast.type === 'success') return <div className="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-green-500 bg-green-100 rounded-lg dark:bg-green-800 dark:text-green-200">✓</div>;
        if(toast.type === 'error') return <div className="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-red-500 bg-red-100 rounded-lg dark:bg-red-800 dark:text-red-200">✕</div>;
        return <div className="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-blue-500 bg-blue-100 rounded-lg dark:bg-blue-800 dark:text-blue-200">ℹ</div>;
    }

    return (
        <div className={`${baseClasses} ${typeClasses[toast.type]}`} role="alert">
           <Icon />
            <div className="ml-3 text-sm font-normal">{toast.message}</div>
            <button type="button" onClick={() => onDismiss(toast.id)} className="ml-auto -mx-1.5 -my-1.5 bg-white text-gray-400 hover:text-gray-900 rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-gray-100 inline-flex h-8 w-8 dark:text-gray-500 dark:hover:text-white dark:bg-gray-800 dark:hover:bg-gray-700" aria-label="Close">
                <span className="sr-only">Close</span>
                &times;
            </button>
        </div>
    );
};


export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Use a ref counter to guarantee unique, monotonic IDs even when multiple toasts fire within the same millisecond
  const idCounterRef = React.useRef<number>(0);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++idCounterRef.current; // ensures unique, incremental IDs per session
    setToasts(prevToasts => [{ id, ...toast }, ...prevToasts]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed top-5 right-5 z-[100]">
        {toasts.map(toast => (
          <ToastMessage key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

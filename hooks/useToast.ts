import { useContext, useCallback } from 'react';
import { ToastContext } from '../components/ToastProvider';

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  // Return a stable function that accepts either (message, type) or ({message, type})
  return useCallback(
    (
      messageOrObject: string | { message: string; type: 'success' | 'error' | 'info' },
      type?: 'success' | 'error' | 'info'
    ) => {
      if (typeof messageOrObject === 'string') {
        // Called as addToast(message, type)
        context.addToast({ message: messageOrObject, type: (type || 'info') });
      } else {
        // Called as addToast({message, type})
        context.addToast(messageOrObject);
      }
    },
    [context]
  );
};

import React, { useState, useEffect } from 'react';
import { getBackendHealth } from '../services/enhancedAPI';

interface BackendStatusProps {
  className?: string;
}

export const BackendStatus: React.FC<BackendStatusProps> = ({ className = '' }) => {
  const [status, setStatus] = useState<{
    isHealthy: boolean;
    apiUrl: string;
    usingBackend: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const health = await getBackendHealth();
        setStatus(health);
      } catch (error) {
        console.error('Failed to check backend health:', error);
        setStatus({
          isHealthy: false,
          apiUrl: 'Health check failed',
          usingBackend: false
        });
      } finally {
        setLoading(false);
      }
    };

    checkHealth();
    
    // Check health every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !status) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="h-2 w-2 bg-gray-400 rounded-full animate-pulse"></div>
        <span className="text-sm text-gray-500">Checking backend...</span>
      </div>
    );
  }

  const statusColor = status.isHealthy ? 'bg-green-400' : 'bg-red-400';
  const statusText = status.usingBackend 
    ? (status.isHealthy ? 'Backend Connected' : 'Backend Offline')
    : 'Firebase Only';

  return (
    <div className={`flex items-center space-x-2 ${className}`} title={status.apiUrl}>
      <div className={`h-2 w-2 ${statusColor} rounded-full ${status.isHealthy ? 'animate-pulse' : ''}`}></div>
      <span className="text-sm text-gray-600 dark:text-gray-400">{statusText}</span>
    </div>
  );
};
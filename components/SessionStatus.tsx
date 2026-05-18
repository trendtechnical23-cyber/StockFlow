import React, { useState, useEffect } from 'react';

interface SessionStatusProps {
  isActive: boolean;
  className?: string;
}

const SessionStatus: React.FC<SessionStatusProps> = ({ isActive, className = '' }) => {
  const [lastActivity, setLastActivity] = useState<Date>(new Date());

  useEffect(() => {
    if (isActive) {
      setLastActivity(new Date());
    }
  }, [isActive]);

  const getStatusColor = () => {
    if (isActive) {
      return 'bg-green-500';
    }
    return 'bg-yellow-500';
  };

  const getStatusText = () => {
    if (isActive) {
      return 'Active';
    }
    return 'Idle';
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      <div className="flex items-center gap-1">
        <div className={`w-2 h-2 rounded-full ${getStatusColor()}`}></div>
        <span className="text-gray-600 dark:text-gray-400">
          {getStatusText()}
        </span>
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-500 hidden sm:inline">
        {isActive ? 'Now' : `Last: ${formatTime(lastActivity)}`}
      </span>
    </div>
  );
};

export default SessionStatus;
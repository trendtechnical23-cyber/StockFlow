import React, { useState, useEffect } from 'react';

interface IdleWarningModalProps {
    isOpen: boolean;
    countdown: number;
    onStayLoggedIn: () => void;
    onLogout: () => void;
    idleTimeoutMinutes?: number;
}

const IdleWarningModal: React.FC<IdleWarningModalProps> = ({
    isOpen,
    countdown,
    onStayLoggedIn,
    onLogout,
    idleTimeoutMinutes = 10,
}) => {
    if (!isOpen) return null;

    const formatTime = (seconds: number) => {
        return seconds > 0 ? seconds : 0;
    };

    const getTimeoutText = () => {
        if (idleTimeoutMinutes < 1) {
            return `${Math.round(idleTimeoutMinutes * 60)} seconds`;
        }
        return idleTimeoutMinutes === 1 ? '1 minute' : `${idleTimeoutMinutes} minutes`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full mx-4 p-6 border border-gray-200 dark:border-gray-700">
                {/* Warning Icon */}
                <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-yellow-100 dark:bg-yellow-900/50 rounded-full">
                    <svg 
                        className="w-8 h-8 text-yellow-600 dark:text-yellow-400" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                    >
                        <path 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                            strokeWidth="2" 
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                        />
                    </svg>
                </div>

                {/* Title */}
                <h3 className="text-xl font-bold text-center text-gray-900 dark:text-gray-100 mb-2">
                    Session Timeout Warning
                </h3>

                {/* Message */}
                <p className="text-center text-gray-600 dark:text-gray-400 mb-6">
                    You've been inactive for {getTimeoutText()}. You will be automatically logged out in:
                </p>

                {/* Countdown */}
                <div className="flex items-center justify-center mb-6">
                    <div className="bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 px-4 py-2 rounded-lg font-mono text-2xl font-bold">
                        {formatTime(countdown)}s
                    </div>
                </div>

                {/* Security Info */}
                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg mb-6">
                    <p className="text-sm text-blue-700 dark:text-blue-400 text-center">
                        🔒 This is a security feature to protect your account when you're away.
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-3">
                    <button
                        onClick={onStayLoggedIn}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    >
                        Stay Logged In
                    </button>
                    <button
                        onClick={onLogout}
                        className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                    >
                        Logout Now
                    </button>
                </div>

                {/* Auto-logout notice */}
                <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-3">
                    You will be automatically logged out when the countdown reaches zero.
                </p>
            </div>
        </div>
    );
};

export default IdleWarningModal;
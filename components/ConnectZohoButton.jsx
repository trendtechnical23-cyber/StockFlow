import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../utils/apiConfig';

const ConnectZohoButton = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [error, setError] = useState(null);

    // Check connection status on component mount
    useEffect(() => {
        checkConnectionStatus();
    }, []);

    /**
     * Fetch user's Zoho connection status from API
     */
    const checkConnectionStatus = async () => {
        try {
            setIsLoading(true);
            setError(null);

            const response = await fetch('/api/me', {
                method: 'GET',
                credentials: 'include', // Include cookies for authentication
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to check connection status: ${response.status}`);
            }

            const userData = await response.json();
            setIsConnected(userData.zohoConnected || false);

        } catch (err) {
            console.error('❌ Error checking Zoho connection status:', err);
            setError(err.message);
            setIsConnected(false);
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Initiate Zoho OAuth connection
     */
    const handleConnect = async () => {
        try {
            setIsConnecting(true);
            setError(null);

            // Get the current user and organization context
            // This should be passed as props or obtained from context
            const organizationId = 'org_1760260436874_mc71a611s'; // Replace with actual org ID from context
            const userId = 'current_user_id'; // Replace with actual user ID from context

            // Get auth URL from backend
            const response = await fetch(API_ENDPOINTS.zohoAuthUrl(organizationId, userId), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get auth URL: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Failed to generate authorization URL');
            }

            // Redirect to Zoho OAuth page
            window.location.href = data.authUrl;

        } catch (err) {
            console.error('❌ Error initiating Zoho connection:', err);
            setError(err.message);
            setIsConnecting(false);
        }
    };

    /**
     * Disconnect Zoho integration
     */
    const handleDisconnect = async () => {
        if (!window.confirm('Are you sure you want to disconnect your Zoho Books integration? This will remove access to your Zoho data.')) {
            return;
        }

        try {
            setIsDisconnecting(true);
            setError(null);

            const response = await fetch('/api/zoho/disconnect', {
                method: 'DELETE',
                credentials: 'include', // Include cookies for authentication
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Failed to disconnect: ${response.status}`);
            }

            // Successfully disconnected
            setIsConnected(false);
            console.log('✅ Zoho integration disconnected successfully');

        } catch (err) {
            console.error('❌ Error disconnecting Zoho integration:', err);
            setError(err.message);
        } finally {
            setIsDisconnecting(false);
        }
    };

    /**
     * Retry connection status check
     */
    const handleRetry = () => {
        checkConnectionStatus();
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
                <span className="text-gray-600">Checking Zoho connection...</span>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-red-700 text-sm">Error: {error}</span>
                    </div>
                    <button
                        onClick={handleRetry}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Connection Status */}
            <div className="flex items-center space-x-3 p-4 bg-white rounded-lg border">
                <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                <div className="flex-1">
                    <h3 className="font-medium text-gray-900">Zoho Books Integration</h3>
                    <p className="text-sm text-gray-600">
                        {isConnected ? 'Connected and ready to sync' : 'Not connected'}
                    </p>
                </div>
                <div className="flex items-center space-x-2">
                    {isConnected ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Connected
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Not Connected
                        </span>
                    )}
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3">
                {isConnected ? (
                    <button
                        onClick={handleDisconnect}
                        disabled={isDisconnecting}
                        className="flex items-center space-x-2 px-4 py-2 border border-red-300 text-red-700 font-medium rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isDisconnecting ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                                <span>Disconnecting...</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                                <span>Disconnect</span>
                            </>
                        )}
                    </button>
                ) : (
                    <button
                        onClick={handleConnect}
                        disabled={isConnecting}
                        className="flex items-center space-x-2 px-6 py-2 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isConnecting ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>Connecting...</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                <span>Connect to Zoho Books</span>
                            </>
                        )}
                    </button>
                )}

                {/* Refresh Status Button */}
                <button
                    onClick={handleRetry}
                    disabled={isLoading}
                    className="flex items-center space-x-2 px-3 py-2 border border-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Refresh connection status"
                >
                    <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            </div>

            {/* Connection Info */}
            {isConnected && (
                <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-start space-x-2">
                        <svg className="w-5 h-5 text-green-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <p className="text-sm font-medium text-green-800">
                                Your Zoho Books account is connected
                            </p>
                            <p className="text-xs text-green-600 mt-1">
                                You can now import items, sync inventory, and manage your data from Zoho Books.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConnectZohoButton;
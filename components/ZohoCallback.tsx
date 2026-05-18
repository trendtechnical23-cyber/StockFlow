import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';
import { API_ENDPOINTS } from '../utils/apiConfig';
import { auth } from '../services/firebase';

interface ZohoCallbackProps {
    code: string;
    state: string;
    onComplete: () => void;
    onConfigure?: () => void; // Reopens the setup modal for user-initiated reconnect
}

const ZohoCallback: React.FC<ZohoCallbackProps> = ({ code, state, onComplete, onConfigure }) => {
    const { handleUpdateIntegration } = useAppContext();
    const addToast = useToast();
    const [isProcessing, setIsProcessing] = useState(true);
    const [status, setStatus] = useState('Processing Zoho connection...');
    const [showDiagnostic, setShowDiagnostic] = useState(false);

    // Ensure we only process the callback ONCE (protects against React Strict Mode double-invoke)
    const processedRef = useRef(false);

    useEffect(() => {
        if (processedRef.current) return;
        processedRef.current = true;

        const processCallback = async () => {
            try {
                if (!code || !state) {
                    addToast({ message: 'Missing authorization parameters. Please try connecting again.', type: 'error' });
                    setStatus('Invalid or missing callback parameters');
                    setIsProcessing(false);
                    setTimeout(onComplete, 1500);
                    return;
                }

                // Guard: prevent processing the same code twice (e.g. page re-render)
                const sessionKey = `zoho_cb_${code}`;
                if (sessionStorage.getItem(sessionKey)) {
                    setIsProcessing(false);
                    setTimeout(onComplete, 1000);
                    return;
                }
                sessionStorage.setItem(sessionKey, '1');

                setStatus('Exchanging authorization code for tokens...');

                if (!auth.currentUser) {
                    throw new Error('User not authenticated. Please log in and try again.');
                }

                const idToken = await auth.currentUser.getIdToken();
                const response = await fetch(API_ENDPOINTS.zohoAuthCallback, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({ code, state })
                });

                // Guard against non-JSON responses (proxy errors, HTML error pages, etc.)
                if (!response.headers.get('content-type')?.includes('application/json')) {
                    throw new Error(`Unexpected response from server (HTTP ${response.status}). Check your backend is running.`);
                }

                const data = await response.json();

                if (!response.ok) {
                    console.error('❌ Backend error:', data);

                    // invalid_code = code already used OR redirect URI mismatch.
                    // OAuth rule: one shot, fail = stop. User must reconnect manually.
                    const isInvalidCode =
                        data?.error?.toLowerCase().includes('invalid_code') ||
                        data?.message?.toLowerCase().includes('invalid_code') ||
                        data?.message?.toLowerCase().includes('expired');

                    if (isInvalidCode) {
                        sessionStorage.removeItem(sessionKey);
                        setStatus('Authorization expired. Please reconnect.');
                        setShowDiagnostic(true);
                        setIsProcessing(false);
                        addToast({ message: 'Zoho session expired. Please reconnect.', type: 'error' });
                        return;
                    }

                    throw new Error(data.message || `HTTP ${response.status}: ${data.error || 'Unknown error'}`);
                }

                if (!data.success) {
                    throw new Error(data.message || 'Token exchange failed');
                }

                setStatus('Updating integration status...');
                await handleUpdateIntegration('zoho', 'connected');
                window.history.replaceState({}, document.title, window.location.pathname);
                addToast({ message: 'Successfully connected to Zoho Books!', type: 'success' });
                setIsProcessing(false);
                setTimeout(onComplete, 2000);

            } catch (error) {
                console.error('❌ Zoho callback error:', error);
                addToast({
                    message: error instanceof Error ? error.message : 'Failed to connect to Zoho Books',
                    type: 'error'
                });
                setStatus('Connection failed');
                setIsProcessing(false);
                setTimeout(onComplete, 3000);
            }
        };

        processCallback();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
                <div className="text-center">
                    <div className="mb-4">
                        {isProcessing ? (
                            <div className="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
                        ) : (
                            <div className="w-12 h-12 mx-auto">
                                <div className="w-full h-full bg-green-500 rounded-full flex items-center justify-center">
                                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                                    </svg>
                                </div>
                            </div>
                        )}
                    </div>
                    <h3 className="text-lg font-semibold mb-2">
                        {isProcessing ? 'Connecting to Zoho Books' : showDiagnostic ? 'Redirect URI Mismatch' : 'Connection Complete'}
                    </h3>
                    <p className="text-gray-600 text-sm">{status}</p>
                    {showDiagnostic && (
                        <div className="mt-4 text-left bg-red-50 border border-red-200 rounded-lg p-4">
                            <p className="text-sm font-semibold text-red-800 mb-2">What to check:</p>
                            <ol className="text-sm text-red-700 space-y-1 list-decimal list-inside">
                                <li>Open <strong>Zoho Developer Console</strong> → your client app</li>
                                <li>Under <strong>Authorized Redirect URIs</strong>, the URI must exactly match what you entered in StockFlow's Zoho setup</li>
                                <li>If using a dev tunnel, the tunnel URL changes every session — update it in both places</li>
                            </ol>
                            {onConfigure && (
                                <button
                                    onClick={onConfigure}
                                    className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded"
                                >
                                    Reconfigure Zoho Settings
                                </button>
                            )}
                            <button
                                onClick={onComplete}
                                className="mt-2 w-full border border-gray-300 text-gray-700 text-sm py-2 px-4 rounded hover:bg-gray-50"
                            >
                                Dismiss
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ZohoCallback;
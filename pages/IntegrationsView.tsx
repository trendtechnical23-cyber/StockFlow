import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';
import { importFromZoho, importFromPos, getZohoItems, updateOrganizationIntegrations } from '../services/apiService';
import { ZohoService } from '../services/zohoService';
import { PosService } from '../services/posService';
import ZohoCallback from '../components/ZohoCallback';
import PosSetupModal from '../components/PosSetupModal';
import ZohoSetupModal from '../components/ZohoSetupModal';
import GoogleSheetsImportModal from '../components/GoogleSheetsImportModal';
import ExcelImportModal from '../components/ExcelImportModal';
import { QRCodeCanvas } from 'qrcode.react';
import { API_ENDPOINTS } from '../utils/apiConfig';
import { getAccessToken } from '../services/supabase';

const ZohoIcon: React.FC = () => (
    <svg className="w-12 h-12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 4C12.95 4 4 12.95 4 24C4 35.05 12.95 44 24 44C35.05 44 44 35.05 44 24C44 12.95 35.05 4 24 4Z" fill="#F44336"/>
        <path d="M24 11C18.48 11 14 15.48 14 21C14 24.32 15.84 27.26 18.5 28.85V18.5C18.5 17.67 19.17 17 20 17H29.5C29.5 13.69 27.05 11 24 11Z" fill="white"/>
        <path d="M29.5 29.15V34.5C29.5 35.33 28.83 36 28 36H18.5C18.5 39.31 20.95 42 24 42C29.52 42 34 37.52 34 32C34 29.68 32.16 26.74 29.5 25.15V29.15Z" fill="white" fillOpacity="0.7"/>
    </svg>
);

const GoogleSheetsIcon: React.FC = () => (
    <svg className="w-12 h-12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M37 45H11c-3.3 0-6-2.7-6-6V9c0-3.3 2.7-6 6-6h18l14 14v28c0 3.3-2.7 6-6 6z" fill="#0F9D58"/>
        <path d="M40 17L27 17 27 4z" fill="white" fillOpacity="0.15"/>
        <path d="M30 17h10l-10-10v10z" fill="white" fillOpacity="0.35"/>
        <path d="M15 22h18v3H15zm0 6h18v3H15zm0 6h18v3H15z" fill="white"/>
    </svg>
);

const ExcelIcon: React.FC = () => (
    <svg className="w-12 h-12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M37 45H11c-3.3 0-6-2.7-6-6V9c0-3.3 2.7-6 6-6h18l14 14v28c0 3.3-2.7 6-6 6z" fill="#217346"/>
        <path d="M40 17L27 17 27 4z" fill="white" fillOpacity="0.15"/>
        <path d="M30 17h10l-10-10v10z" fill="white" fillOpacity="0.35"/>
        <path d="M19 22l5 6.5L29 22h3l-6.5 8.5L32 39h-3l-5-6.5L19 39h-3l6.5-8.5L16 22h3z" fill="white"/>
    </svg>
);

const MobileIcon: React.FC = () => (
    <svg className="w-12 h-12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M32 6H16c-2.21 0-4 1.79-4 4v28c0 2.21 1.79 4 4 4h16c2.21 0 4-1.79 4-4V10c0-2.21-1.79-4-4-4z" fill="#4CAF50"/>
        <path d="M16 8h16c1.1 0 2 .9 2 2v28c0 1.1-.9 2-2 2H16c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2z" fill="#E8F5E8"/>
        <rect x="16" y="12" width="16" height="20" fill="#4CAF50"/>
        <circle cx="24" cy="36" r="2" fill="#4CAF50"/>
        <rect x="20" y="6" width="8" height="2" rx="1" fill="#2E7D32"/>
    </svg>
);

const PosIcon: React.FC = () => (
    <svg className="w-12 h-12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="8" width="36" height="32" rx="4" fill="#7C3AED"/>
        <rect x="10" y="12" width="28" height="14" rx="2" fill="#EDE9FE"/>
        <rect x="10" y="30" width="8" height="6" rx="1" fill="#DDD6FE"/>
        <rect x="20" y="30" width="8" height="6" rx="1" fill="#DDD6FE"/>
        <rect x="30" y="30" width="8" height="6" rx="1" fill="#C4B5FD"/>
        <text x="24" y="22" textAnchor="middle" fill="#7C3AED" fontSize="8" fontWeight="bold">POS</text>
    </svg>
);


const IntegrationsView: React.FC = () => {
    const { state, handleUpdateIntegration } = useAppContext();
    const { currentOrganization } = state;
    const addToast = useToast();
    const [isConnecting, setIsConnecting] = useState(false);
    const [showCallback, setShowCallback] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [showGoogleSheetsModal, setShowGoogleSheetsModal] = useState(false);
    const [showExcelModal, setShowExcelModal] = useState(false);
    const [copiedOrgId, setCopiedOrgId] = useState(false);
    const [oauthCode, setOauthCode] = useState<string | null>(null);
    const [oauthState, setOauthState] = useState<string | null>(null);

    // Zoho setup modal state
    const [showZohoSetup, setShowZohoSetup] = useState(false);
    const [zohoConfigured, setZohoConfigured] = useState<boolean | null>(null);

    // POS integration state
    const [showPosSetup, setShowPosSetup] = useState(false);
    const [posStatus, setPosStatus] = useState<'connected' | 'disconnected'>('disconnected');
    const [posProvider, setPosProvider] = useState<string>('');
    const [isPosImporting, setIsPosImporting] = useState(false);
    const [isPosDisconnecting, setIsPosDisconnecting] = useState(false);

    const zohoStatus = currentOrganization.integrations?.zoho?.status ?? 'disconnected';
    const isConnected = zohoStatus === 'connected';

    // Load POS status from Firestore on mount
    useEffect(() => {
        const posData = currentOrganization.integrations?.pos;
        if (posData) {
            setPosStatus(posData.status || 'disconnected');
            setPosProvider(posData.provider || '');
        }
    }, [currentOrganization.integrations?.pos]);

    const checkedOnceRef = useRef(false);
    useEffect(() => {
        if (checkedOnceRef.current) return;
        checkedOnceRef.current = true;
        
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        
        if (code && state && !showCallback) {
            try {
                const decodedState = JSON.parse(atob(state));
                if (decodedState.organizationId) {
                    setOauthCode(code);
                    setOauthState(state);
                    setShowCallback(true);
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            } catch (e) {
                if (state === 'zoho') {
                    setOauthCode(code);
                    setOauthState(state);
                    setShowCallback(true);
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            }
        } else if (!code || !state) {
            if (window.location.pathname.includes('/callback/zoho')) {
                window.history.replaceState({}, document.title, '/');
            }
        }
    }, [showCallback]);

    const proceedWithZohoOAuth = async () => {
        setIsConnecting(true);
        addToast({ message: 'Redirecting to Zoho Books...', type: 'info' });
        try {
            const organizationId = currentOrganization?.id || 'unknown';
            const userId = state.currentUser?.uid || 'unknown';
            const token = await getAccessToken();
            const response = await fetch(API_ENDPOINTS.zohoAuthUrl(organizationId, userId), {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
            setTimeout(() => { window.location.href = data.authUrl; }, 300);
        } catch (error: any) {
            addToast({ message: `Failed to connect to Zoho Books: ${error.message}`, type: 'error' });
            setIsConnecting(false);
        }
    };

    const handleConnect = async () => {
        // Always show the setup modal so the user can verify/update credentials before OAuth.
        // Pre-populate with any previously saved config (except the secret).
        setShowZohoSetup(true);
    };

    const handleDisconnect = async () => {
        setIsConnecting(true);
        try {
            await ZohoService.removeTokens(currentOrganization.id);
            await handleUpdateIntegration('zoho', 'disconnected');
            addToast({ message: 'Successfully disconnected from Zoho Books', type: 'success' });
        } catch (error) {
            addToast({ message: 'Failed to disconnect from Zoho Books.', type: 'error' });
        }
        setIsConnecting(false);
    };

    const handleDebugImport = async () => {
        if (!isConnected) {
            addToast({ message: 'Please connect to Zoho Books first', type: 'error' });
            return;
        }

        setIsImporting(true);
        addToast({ message: 'Running debug import (first 5 items)...', type: 'info' });
        
        try {
            const rawItems = await getZohoItems(currentOrganization.id);

            console.log('🔍 RAW ZOHO DATA (first 5 items):');
            rawItems.slice(0, 5).forEach((item: any, index: number) => {
                console.log(`📦 Item ${index + 1}:`, {
                    name: item.name,
                    item_id: item.item_id,
                    sku: item.sku,
                    stock_on_hand: item.stock_on_hand,
                    full_raw_item: item
                });
            });

            addToast({ message: `Debug complete! Check console for details of ${rawItems.length} items.`, type: 'success' });
        } catch (error: any) {
            addToast({ message: `Debug import failed: ${error.message}`, type: 'error' });
        } finally {
            setIsImporting(false);
        }
    };

    const handleImportFromZoho = async () => {
        if (!isConnected) {
            addToast({ message: 'Please connect to Zoho Books first', type: 'error' });
            return;
        }

        setIsImporting(true);
        addToast({ message: 'Fetching & importing all items from Zoho Books…', type: 'info' });

        try {
            // importFromZoho now delegates entirely to the backend in one call
            // (fetch from Zoho + transform + upsert into Supabase)
            const importedItems = await importFromZoho([], currentOrganization.id);

            const importedCount = (importedItems as any)._importedCount ?? 0;
            const totalZoho    = (importedItems as any)._totalZoho    ?? importedCount;

            addToast({
                message: `Successfully imported ${importedCount} items from Zoho Books (${totalZoho} total fetched).`,
                type: 'success',
            });

            setTimeout(() => window.location.reload(), 2000);
            
        } catch (error: any) {
            addToast({ message: error.message || 'Failed to import from Zoho Books', type: 'error' });
        }

        setIsImporting(false);
    };

    const handleImportSuccess = () => {
        setTimeout(() => window.location.reload(), 2000);
    };

    // --- POS handlers ---
    const handlePosConnected = () => {
        setPosStatus('connected');
        // Refresh org data to pick up the new integration
        addToast({ message: 'POS system connected successfully!', type: 'success' });
        setTimeout(() => window.location.reload(), 1500);
    };

    const handlePosDisconnect = async () => {
        setIsPosDisconnecting(true);
        try {
            await PosService.disconnect(currentOrganization.id);
            await handleUpdateIntegration('pos', 'disconnected');
            setPosStatus('disconnected');
            setPosProvider('');
            addToast({ message: 'POS system disconnected', type: 'success' });
        } catch (error: any) {
            addToast({ message: `Failed to disconnect POS: ${error.message}`, type: 'error' });
        } finally {
            setIsPosDisconnecting(false);
        }
    };

    const handlePosImport = async () => {
        setIsPosImporting(true);
        addToast({ message: 'Fetching items from POS system...', type: 'info' });

        try {
            const data = await PosService.getItems(currentOrganization.id);
            addToast({ message: `Retrieved ${data.items.length} items. Importing...`, type: 'info' });

            const imported = await importFromPos(data.items, currentOrganization.id);

            const dupsOverwritten = (imported as any)._duplicatesOverwritten || 0;
            const dupItems = (imported as any)._duplicateItems || [];
            if (dupsOverwritten > 0) {
                const list = dupItems.slice(0, 3).join(', ');
                const more = dupsOverwritten > 3 ? ` and ${dupsOverwritten - 3} more` : '';
                addToast({ message: `Imported ${imported.length} items. Overwrote ${dupsOverwritten} duplicate(s): ${list}${more}`, type: 'info' });
            } else {
                addToast({ message: `Successfully imported ${imported.length} items from POS.`, type: 'success' });
            }

            setTimeout(() => window.location.reload(), 2000);
        } catch (error: any) {
            addToast({ message: error.message || 'POS import failed', type: 'error' });
        } finally {
            setIsPosImporting(false);
        }
    };

    const handleCopyOrgId = async () => {
        try {
            await navigator.clipboard.writeText(currentOrganization.id);
            setCopiedOrgId(true);
            addToast({ message: 'Organization ID copied!', type: 'success' });
            setTimeout(() => setCopiedOrgId(false), 2000);
        } catch (error) {
            addToast({ message: 'Failed to copy organization ID', type: 'error' });
        }
    };

    if (showCallback) {
        if (!oauthCode || !oauthState) {
            setShowCallback(false);
            if (window.location.pathname.includes('/callback')) {
                window.history.replaceState({}, document.title, '/');
            }
            return null;
        }
        
        return (
            <ZohoCallback
                code={oauthCode}
                state={oauthState}
                onComplete={() => {
                    setShowCallback(false);
                    setOauthCode(null);
                    setOauthState(null);
                }}
                onConfigure={() => {
                    setShowCallback(false);
                    setOauthCode(null);
                    setOauthState(null);
                    setShowZohoSetup(true);
                }}
            />
        );
    }

    return (
        <div className="space-y-8 max-w-4xl mx-auto p-4">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Integrations</h1>
            <p className="text-gray-600 dark:text-gray-400">
                Connect your other business tools to StockFlow to automate your inventory management.
            </p>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-200">Available Integrations</h2>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    
                    {/* Zoho Books Integration Card */}
                    <div className="flex items-center justify-between py-6">
                        <div className="flex items-center gap-4">
                            <ZohoIcon />
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">Zoho Books</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Sync your items and stock levels automatically.</p>
                            </div>
                        </div>
                        <div className="text-right">
                             {isConnected ? (
                                <>
                                    <span className="inline-flex items-center px-3 py-1 text-sm font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                                        Connected
                                    </span>
                                    <div className="mt-2 space-x-2">
                                        <button 
                                            onClick={handleImportFromZoho} 
                                            disabled={isImporting} 
                                            className="px-3 py-1 text-sm bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-wait transition-colors"
                                        >
                                            {isImporting ? 'Importing...' : 'Import All Items'}
                                        </button>
                                        <button 
                                            onClick={handleDebugImport} 
                                            disabled={isImporting} 
                                            className="px-3 py-1 text-sm bg-purple-600 text-white font-semibold rounded-md hover:bg-purple-700 disabled:bg-purple-300 disabled:cursor-wait transition-colors"
                                        >
                                            {isImporting ? 'Debugging...' : 'Debug Import'}
                                        </button>
                                        <button
                                            onClick={() => setShowZohoSetup(true)}
                                            disabled={isImporting || isConnecting}
                                            className="px-3 py-1 text-sm bg-gray-500 text-white font-semibold rounded-md hover:bg-gray-600 disabled:opacity-50 transition-colors"
                                        >
                                            Reconfigure
                                        </button>
                                        <button 
                                            onClick={handleDisconnect} 
                                            disabled={isConnecting || isImporting} 
                                            className="px-3 py-1 text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <button onClick={handleConnect} disabled={isConnecting} className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:bg-indigo-800 disabled:cursor-wait transition-colors">
                                    {isConnecting ? 'Connecting...' : 'Connect'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Google Sheets Integration Card */}
                    <div className="flex items-center justify-between py-6">
                        <div className="flex items-center gap-4">
                            <GoogleSheetsIcon />
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">Google Sheets</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Import inventory data from a Google Sheets document.</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <button 
                                onClick={() => setShowGoogleSheetsModal(true)}
                                className="px-4 py-2 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 transition-colors"
                            >
                                Import from Sheets
                            </button>
                        </div>
                    </div>

                    {/* POS System Integration Card */}
                    <div className="flex items-center justify-between py-6">
                        <div className="flex items-center gap-4">
                            <PosIcon />
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">Point of Sale</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {posStatus === 'connected' && posProvider
                                        ? `Connected to ${posProvider.charAt(0).toUpperCase() + posProvider.slice(1)} — sync inventory from your POS.`
                                        : 'Connect Odoo or another POS system to import inventory.'}
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            {posStatus === 'connected' ? (
                                <>
                                    <span className="inline-flex items-center px-3 py-1 text-sm font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                                        Connected
                                    </span>
                                    <div className="mt-2 space-x-2">
                                        <button
                                            onClick={handlePosImport}
                                            disabled={isPosImporting}
                                            className="px-3 py-1 text-sm bg-purple-600 text-white font-semibold rounded-md hover:bg-purple-700 disabled:bg-purple-300 disabled:cursor-wait transition-colors"
                                        >
                                            {isPosImporting ? 'Importing...' : 'Import Items'}
                                        </button>
                                        <button
                                            onClick={handlePosDisconnect}
                                            disabled={isPosDisconnecting || isPosImporting}
                                            className="px-3 py-1 text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <button
                                    onClick={() => setShowPosSetup(true)}
                                    className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-md hover:bg-purple-700 transition-colors"
                                >
                                    Connect POS
                                </button>
                            )}
                        </div>
                    </div>

                    {/* CSV/Spreadsheet Integration Card */}
                    <div className="flex items-center justify-between py-6">
                        <div className="flex items-center gap-4">
                            <ExcelIcon />
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">CSV Import</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Upload CSV files with custom column mapping.</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <button 
                                onClick={() => setShowExcelModal(true)}
                                className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors"
                            >
                                Upload File
                            </button>
                        </div>
                    </div>

                    {/* Mobile App Connection Card */}
                    <div className="flex items-start justify-between py-6">
                        <div className="flex items-start gap-4">
                            <MobileIcon />
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">Mobile App Connection</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Connect the StockFlow mobile app to this organization.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                            <div className="flex-grow">
                                <p className="text-xs text-gray-600 dark:text-gray-400 font-medium mb-1">Organization ID:</p>
                                <div className="flex items-center gap-2">
                                    <code className="text-sm font-mono bg-white dark:bg-gray-800 px-2 py-1 rounded border text-gray-800 dark:text-gray-200">
                                        {currentOrganization.id}
                                    </code>
                                    <button
                                        onClick={handleCopyOrgId}
                                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                        title="Copy Organization ID"
                                    >
                                        {copiedOrgId ? (
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                            </svg>
                                        ) : (
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                                            </svg>
                                        )}
                                    </button>
                                </div>
                            </div>
                            <div className="p-2 bg-white rounded-lg shadow-md">
                                <QRCodeCanvas
                                    value={currentOrganization.id}
                                    size={100}
                                    bgColor={"#ffffff"}
                                    fgColor={"#000000"}
                                    level={"L"}
                                    includeMargin={false}
                                />
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {showGoogleSheetsModal && (
                <GoogleSheetsImportModal
                    isOpen={showGoogleSheetsModal}
                    onClose={() => setShowGoogleSheetsModal(false)}
                    onImportSuccess={handleImportSuccess}
                />
            )}

            {showExcelModal && (
                <ExcelImportModal
                    isOpen={showExcelModal}
                    onClose={() => setShowExcelModal(false)}
                    onImportSuccess={handleImportSuccess}
                />
            )}

            {showPosSetup && (
                <PosSetupModal
                    isOpen={showPosSetup}
                    onClose={() => setShowPosSetup(false)}
                    orgId={currentOrganization.id}
                    onConnected={handlePosConnected}
                />
            )}

            {showZohoSetup && (
                <ZohoSetupModal
                    isOpen={showZohoSetup}
                    onClose={() => setShowZohoSetup(false)}
                    orgId={currentOrganization.id}
                    onConfigSaved={async () => {
                        setShowZohoSetup(false);
                        setZohoConfigured(true);
                        await proceedWithZohoOAuth();
                    }}
                />
            )}
        </div>
    );
};

export default IntegrationsView;
                                               
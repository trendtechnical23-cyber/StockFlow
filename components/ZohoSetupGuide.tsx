import React, { useState } from 'react';

const ZohoSetupGuide: React.FC = () => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center">
                    <div className="flex-shrink-0">
                        <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                    </div>
                    <div className="ml-3">
                        <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            Setup Zoho Books Integration
                        </h3>
                    </div>
                </div>
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-100"
                >
                    <svg className={`w-5 h-5 transform ${isExpanded ? 'rotate-180' : ''} transition-transform`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
            
            {isExpanded && (
                <div className="mt-4 text-sm text-blue-700 dark:text-blue-300">
                    <p className="mb-3">To connect Zoho Books, you need to set up API credentials first:</p>
                    
                    <ol className="list-decimal list-inside space-y-2 mb-4">
                        <li>Go to <a href="https://api-console.zoho.com" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">Zoho API Console</a></li>
                        <li>Click "ADD CLIENT" → "Server-side Applications"</li>
                        <li>Fill in the details:
                            <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                                <li><strong>Client Name:</strong> StockFlow Dashboard</li>
                                <li><strong>Homepage URL:</strong> http://localhost:3001</li>
                                <li><strong>Redirect URI:</strong> http://localhost:4000/callback/zoho</li>
                            </ul>
                        </li>
                        <li>Copy your Client ID and Client Secret</li>
                        <li>Update your .env file with the credentials</li>
                        <li>Restart your development server</li>
                    </ol>


                    <div className="bg-white dark:bg-gray-800 rounded p-3 border border-blue-200 dark:border-blue-700">
                        <p className="font-mono text-xs text-gray-600 dark:text-gray-400 mb-2">.env file example:</p>
                        <pre className="font-mono text-xs text-gray-800 dark:text-gray-200 overflow-x-auto">
{`VITE_ZOHO_CLIENT_ID=your_client_id_here
VITE_ZOHO_CLIENT_SECRET=your_client_secret_here`}
                        </pre>
                    </div>

                    <p className="mt-3 text-xs text-blue-600 dark:text-blue-400">
                        <strong>Note:</strong> Make sure to replace "your_client_id_here" and "your_client_secret_here" with your actual Zoho API credentials.
                    </p>
                </div>
            )}
        </div>
    );
};

export default ZohoSetupGuide;
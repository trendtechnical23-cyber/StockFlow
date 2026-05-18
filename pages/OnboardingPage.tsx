import React, { useState } from 'react';
import PosSetupModal from '../components/PosSetupModal';

interface OnboardingPageProps {
  organizationName: string;
  orgId: string;
  onImport: () => Promise<void>;
  onStartFresh: () => void;
  onGoogleSheetsImport: () => void;
  onExcelImport: () => void;
  onPosConnected: () => void;
}

const ImportIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const PosIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h.01M11 15h.01M15 15h.01M7 11h.01M11 11h.01M15 11h.01M19 11h.01M19 15h.01"/><path d="M6 8h12"/></svg>;
const PlusCircleIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>;
const GoogleSheetsIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M11.318 2.532A9.97 9.97 0 0 1 12 2.5c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12.5c0-.243.009-.483.027-.721" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M21 8H8v8h13V8z" fill="#0F9D58"/><path d="M3 8v8h5V8H3z" fill="#F4B400"/><path d="M8 3v5h13V3H8z" fill="#4285F4"/><path d="M3 3v5h5V3H3z" fill="#DB4437"/></svg>;
const ExcelIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 3h18v18H3V3z" fill="#217346"/><path d="M6 6h12v12H6V6z" fill="white"/><path d="M8 8l3 4-3 4h2l2-2.67L14 16h2l-3-4 3-4h-2l-2 2.67L10 8H8z" fill="#217346"/></svg>;
const Spinner = () => <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white"></div>;


const OnboardingPage: React.FC<OnboardingPageProps> = ({ organizationName, orgId, onImport, onStartFresh, onGoogleSheetsImport, onExcelImport, onPosConnected }) => {
  const [isImporting, setIsImporting] = useState(false);
  const [showPosModal, setShowPosModal] = useState(false);

  const handleImport = async () => {
        setIsImporting(true);
        try {
            await onImport();
            // Success path: component will unmount after onboarding ends
        } catch (e) {
            // Error path: reset spinner so user can try a different option
            setIsImporting(false);
        }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 text-center p-4">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-20 h-20 mx-auto text-indigo-500 dark:text-indigo-400 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100">
            Welcome to StockFlow, <span className="text-indigo-500 dark:text-indigo-400">{organizationName}!</span>
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 max-w-2xl">
            Let's get your inventory set up. Choose the best option for you.
        </p>
        <div className="mt-10 flex flex-col items-center gap-8 w-full max-w-2xl">
            
            {/* Start from Scratch Card - Primary Option */}
            <button
                onClick={onStartFresh}
                disabled={isImporting}
                className="w-full flex flex-col items-center justify-center p-8 bg-indigo-600 text-white rounded-2xl shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 disabled:opacity-50"
            >
                <PlusCircleIcon />
                <h2 className="mt-4 text-2xl font-semibold">
                    Start from Scratch
                </h2>
                <p className="mt-2 text-sm text-indigo-100">
                    Begin with an empty inventory and add your items manually. (Recommended)
                </p>
            </button>

            <div className="text-center">
                <p className="text-gray-500 dark:text-gray-400 text-sm">or</p>
            </div>

            {/* Import Options - Secondary */}
            <div className="w-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 text-center">
                    Import from External Source
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 text-center">
                    Note: Import features require setup in the Integrations page first.
                </p>
                
                <div className="space-y-3">
                    {/* Zoho Import - Disabled with explanation */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg opacity-60">
                        <div className="flex items-center gap-3">
                            <ImportIcon />
                            <div>
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">Import from Zoho Books</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Connect Zoho in Integrations first</p>
                            </div>
                        </div>
                        <span className="text-xs text-gray-500 bg-gray-200 dark:bg-gray-600 px-2 py-1 rounded">Setup Required</span>
                    </div>

                    {/* Google Sheets - Links to integrations */}
                    <button 
                        onClick={onGoogleSheetsImport}
                        disabled={isImporting}
                        className="w-full flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-50"
                    >
                        <div className="flex items-center gap-3">
                            <GoogleSheetsIcon />
                            <div className="text-left">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">Import from Google Sheets</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Go to Integrations page</p>
                            </div>
                        </div>
                        <span className="text-xs text-green-600 dark:text-green-400">→</span>
                    </button>

                    {/* CSV Upload - Links to integrations */}
                    <button 
                        onClick={onExcelImport}
                        disabled={isImporting}
                        className="w-full flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
                    >
                        <div className="flex items-center gap-3">
                            <ExcelIcon />
                            <div className="text-left">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">Upload CSV File</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Go to Integrations page</p>
                            </div>
                        </div>
                        <span className="text-xs text-blue-600 dark:text-blue-400">→</span>
                    </button>

                    {/* POS Integration */}
                    <button
                        onClick={() => setShowPosModal(true)}
                        disabled={isImporting}
                        className="w-full flex items-center justify-between p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors disabled:opacity-50"
                    >
                        <div className="flex items-center gap-3">
                            <PosIcon />
                            <div className="text-left">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">Connect Point of Sale (POS)</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Import inventory from Odoo or other POS systems</p>
                            </div>
                        </div>
                        <span className="text-xs text-purple-600 dark:text-purple-400">→</span>
                    </button>
                </div>
            </div>
        </div>

        <PosSetupModal
            isOpen={showPosModal}
            onClose={() => setShowPosModal(false)}
            orgId={orgId}
            onConnected={() => {
                setShowPosModal(false);
                onPosConnected();
            }}
        />
    </div>
  );
};

export default OnboardingPage;

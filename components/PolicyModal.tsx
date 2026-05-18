import React from 'react';

interface PolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: React.ReactNode;
}

const PolicyModal: React.FC<PolicyModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto text-gray-600 dark:text-gray-300 space-y-4">
          {content}
        </div>
        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
};

export const PrivacyPolicy: React.FC = () => (
  <>
    <p><strong>Last Updated: February 25, 2026</strong></p>
    <p>StockFlow ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information.</p>
    <h3 className="font-bold text-gray-900 dark:text-white mt-4">1. Data Collection</h3>
    <p>We collect information you provide directly to us, such as when you create an account, including your name, email address, and organization details.</p>
    <h3 className="font-bold text-gray-900 dark:text-white mt-4">2. Inventory Data</h3>
    <p>Your inventory data is stored securely in regional cloud databases. We do not share your private business data with third parties except as required for service functionality (e.g., Zoho integration).</p>
    <h3 className="font-bold text-gray-900 dark:text-white mt-4">3. Data Security</h3>
    <p>We implement industry-standard security measures, including multi-tenant isolation and encrypted data transmission, to protect your data from unauthorized access.</p>
  </>
);

export const TermsOfService: React.FC = () => (
  <>
    <p><strong>Last Updated: February 25, 2026</strong></p>
    <p>By using StockFlow, you agree to the following terms:</p>
    <h3 className="font-bold text-gray-900 dark:text-white mt-4">1. Usage License</h3>
    <p>We grant you a limited, non-transferable license to use the StockFlow dashboard for your business inventory management.</p>
    <h3 className="font-bold text-gray-900 dark:text-white mt-4">2. Account Responsibility</h3>
    <p>You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account.</p>
    <h3 className="font-bold text-gray-900 dark:text-white mt-4">3. Service Availability</h3>
    <p>While we strive for 99.9% uptime, we are not liable for any business disruptions caused by temporary service outages.</p>
  </>
);

export default PolicyModal;

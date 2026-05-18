import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';

const BillingSuccess: React.FC = () => {
    const { handleUpdateSubscription } = useAppContext();
    const addToast = useToast();
    const [isProcessing, setIsProcessing] = useState(true);

    useEffect(() => {
        const processPaymentSuccess = async () => {
            try {
                // Get URL parameters
                const urlParams = new URLSearchParams(window.location.search);
                const paymentId = urlParams.get('pf_payment_id');
                
                if (paymentId) {
                    // PayFast will send ITN to your webhook
                    // For now, show success message and refresh subscription
                    addToast({ 
                        message: 'Payment successful! Your subscription will be activated shortly.', 
                        type: 'success' 
                    });
                    
                    // Refresh the page after a short delay to show updated subscription
                    setTimeout(() => {
                        window.location.href = '/billing';
                    }, 3000);
                } else {
                    addToast({ 
                        message: 'Payment completed. Please check your subscription status.', 
                        type: 'info' 
                    });
                    
                    setTimeout(() => {
                        window.location.href = '/billing';
                    }, 2000);
                }
            } catch (error) {
                console.error('Error processing payment success:', error);
                addToast({ 
                    message: 'Payment completed but status update failed. Please contact support.', 
                    type: 'error' 
                });
            } finally {
                setIsProcessing(false);
            }
        };

        processPaymentSuccess();
    }, [addToast, handleUpdateSubscription]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="max-w-md w-full space-y-8">
                <div className="text-center">
                    <div className="mx-auto flex items-center justify-center h-24 w-24 rounded-full bg-green-100 dark:bg-green-900">
                        <svg className="h-12 w-12 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 48 48">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="mt-6 text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                        Payment Successful!
                    </h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        {isProcessing ? 
                            'Processing your subscription activation...' : 
                            'Your subscription has been activated successfully.'
                        }
                    </p>
                </div>
                
                <div className="mt-8 space-y-6">
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-4">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <h3 className="text-sm font-medium text-green-800 dark:text-green-200">
                                    What happens next?
                                </h3>
                                <div className="mt-2 text-sm text-green-700 dark:text-green-300">
                                    <ul className="list-disc list-inside space-y-1">
                                        <li>Your subscription will be activated within a few minutes</li>
                                        <li>You'll receive a confirmation email from PayFast</li>
                                        <li>Your new plan features are now available</li>
                                        <li>Billing will occur monthly on the same date</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="text-center">
                        <button
                            onClick={() => window.location.href = '/billing'}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            Return to Billing
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BillingSuccess;
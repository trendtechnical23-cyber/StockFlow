import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../hooks/useToast';
import { getPaymentConfig, initializePayment, cancelSubscription, enforceUsageLimits } from '../services/paymentService';

const CheckCircleIcon: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;

const BillingView: React.FC = () => {
    const { state, handleUpdateSubscription } = useAppContext();
    const { currentOrganization, users, inventory } = state;
    const { subscription } = currentOrganization;
    const addToast = useToast();
    const [isChangingPlan, setIsChangingPlan] = useState(false);
    
    // Check payment processor configuration
    const paymentConfig = getPaymentConfig();
    const usageLimits = enforceUsageLimits(currentOrganization, { users: users.length, items: inventory.length });

    const planFeatures = {
        Free: { users: 1, items: 50, price: 'R0/mo', description: 'Perfect for getting started' },
        Pro: { users: 10, items: 1000, price: 'R199/mo', description: 'Best for growing businesses' },
        Enterprise: { users: 'Unlimited', items: 'Unlimited', price: 'Custom', description: 'For large organizations' },
    };

    const currentPlanLimits = planFeatures[subscription?.plan ?? 'Free'];

    const handleChangePlan = async (newPlan: string) => {
        if (newPlan === subscription?.plan) return;
        
        setIsChangingPlan(true);
        
        try {
            if (newPlan === 'Free') {
                // Handle downgrade - should include cancellation of existing subscription
                const confirmed = window.confirm('Are you sure you want to downgrade to the Free plan? This will cancel your current subscription.');
                if (!confirmed) {
                    setIsChangingPlan(false);
                    return;
                }
                
                // Implement subscription cancellation
                try {
                    console.log('🔄 Canceling subscription for organization:', currentOrganization.id);
                    
                    // Call the updated subscription handler which now includes cancellation logic
                    await handleUpdateSubscription('Free', 'active');
                    
                    console.log('✅ Subscription cancelled successfully');
                } catch (error: any) {
                    console.error('❌ Failed to cancel subscription:', error);
                    addToast({ message: `Failed to cancel subscription: ${error.message}`, type: 'error' });
                    setIsChangingPlan(false);
                    return;
                }
                
                addToast({ message: 'Successfully downgraded to Free plan. Your current subscription remains active until the end of the billing period.', type: 'success' });
            } else {
                                if (!paymentConfig.isConfigured) {
                    addToast({ 
                        message: 'Payment processor not configured. Please check BILLING_INTEGRATION_GUIDE.md for setup instructions.', 
                        type: 'info' 
                    });
                    return;
                }
                
                // Initialize real payment flow
                addToast({ message: 'Redirecting to payment processor...', type: 'info' });
                await initializePayment(newPlan, currentOrganization.id);
            }
        } catch (error) {
            addToast({ message: 'Failed to update subscription. Please try again.', type: 'error' });
        }
        
        setIsChangingPlan(false);
    };

    const handleCancelSubscription = async () => {
        if (subscription?.plan === 'Free') return;
        
        const confirmed = window.confirm('Are you sure you want to cancel your subscription? You will be downgraded to the Free plan.');
        if (!confirmed) return;
        
        await handleChangePlan('Free');
    };

    if (!subscription) {
        return <div>Loading subscription details...</div>;
    }

    return (
        <div className="space-y-8 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Billing & Subscription</h1>
            
            {/* Payment Integration Status Banner */}
            <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded-md">
                <div className="flex">
                    <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                    </div>
                    <div className="ml-3">
                        <p className="text-sm text-green-800">
                            <strong>Payments via WhatsApp:</strong> Tap "Upgrade" to start a payment conversation on WhatsApp.
                        </p>
                    </div>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Current Plan Card */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg flex flex-col">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">Current Plan</h2>
                    <div className="my-4">
                        <p className="text-5xl font-bold text-indigo-500 dark:text-indigo-400">{subscription.plan}</p>
                        <p className="text-xl font-medium text-gray-500 dark:text-gray-400">{currentPlanLimits.price}</p>
                    </div>
                    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                        <p className="flex items-center gap-2"><CheckCircleIcon className="text-green-500" /> Up to {currentPlanLimits.users} users</p>
                        <p className="flex items-center gap-2"><CheckCircleIcon className="text-green-500" /> Up to {currentPlanLimits.items} items</p>
                        <p className="flex items-center gap-2"><CheckCircleIcon className="text-green-500" /> Zoho Books Integration</p>
                    </div>
                    <div className="flex-grow"></div>
                    <div className="mt-6 space-y-2">
                        {subscription.plan !== 'Free' && (
                            <button 
                                onClick={handleCancelSubscription}
                                disabled={isChangingPlan}
                                className="w-full px-4 py-2 bg-red-600 text-white font-semibold rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors">
                                Cancel Subscription
                            </button>
                        )}
                        <button 
                            onClick={() => addToast({ message: 'Billing history will be available once payment processing is configured.', type: 'info' })}
                            className="w-full px-4 py-2 bg-gray-600 text-white font-semibold rounded-md hover:bg-gray-700 transition-colors">
                            View Billing History
                        </button>
                    </div>
                </div>

                {/* Usage Card */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-200">Current Usage</h2>
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-sm font-medium text-gray-600 dark:text-gray-300">
                                <span>Users</span>
                                <span>{users.length} / {currentPlanLimits.users}</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-1">
                                <div className="bg-indigo-600 h-2.5 rounded-full" style={{width: `${typeof currentPlanLimits.users === 'number' ? (users.length / currentPlanLimits.users) * 100 : 5}%`}}></div>
                            </div>
                        </div>
                         <div>
                            <div className="flex justify-between text-sm font-medium text-gray-600 dark:text-gray-300">
                                <span>Inventory Items</span>
                                <span>{inventory.length} / {currentPlanLimits.items}</span>
                            </div>
                             <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-1">
                                <div className="bg-green-600 h-2.5 rounded-full" style={{width: `${typeof currentPlanLimits.items === 'number' ? (inventory.length / currentPlanLimits.items) * 100 : 5}%`}}></div>
                            </div>
                        </div>
                         <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                            {subscription.status === 'trialing' && subscription.endDate && (
                                <p className="text-center text-sm text-yellow-600 dark:text-yellow-400">
                                    Your trial ends on {new Date(subscription.endDate).toLocaleDateString()}.
                                </p>
                            )}
                             {subscription.status === 'active' && (
                                <p className="text-center text-sm text-green-600 dark:text-green-400">
                                    Your subscription is active.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Available Plans */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-200">Available Plans</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Object.entries(planFeatures).map(([planName, features]) => {
                        const isCurrentPlan = subscription?.plan === planName;
                        return (
                            <div 
                                key={planName}
                                className={`border rounded-lg p-4 ${
                                    isCurrentPlan 
                                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' 
                                        : 'border-gray-200 dark:border-gray-600'
                                }`}
                            >
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                        {planName}
                                        {isCurrentPlan && (
                                            <span className="ml-2 text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full dark:bg-indigo-800 dark:text-indigo-100">
                                                Current
                                            </span>
                                        )}
                                    </h3>
                                    <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-2">{features.price}</p>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{features.description}</p>
                                </div>
                                <ul className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                                    <li className="flex items-center gap-2">
                                        <CheckCircleIcon className="text-green-500 w-4 h-4" />
                                        {features.users} users
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <CheckCircleIcon className="text-green-500 w-4 h-4" />
                                        {features.items} items
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <CheckCircleIcon className="text-green-500 w-4 h-4" />
                                        All integrations
                                    </li>
                                </ul>
                                <button
                                    onClick={() => handleChangePlan(planName)}
                                    disabled={isCurrentPlan || isChangingPlan}
                                    className={`w-full mt-4 px-4 py-2 rounded-md font-semibold transition-colors ${
                                        isCurrentPlan
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-600 dark:text-gray-400'
                                            : planName === 'Pro' || planName === 'Enterprise'
                                            ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                                            : 'bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50'
                                    }`}
                                >
                                    {isChangingPlan ? 'Processing...' : isCurrentPlan ? 'Current Plan' : 
                                     planName === 'Free' ? 'Downgrade' : 'Upgrade'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
            
            {/* Billing Support Section */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Need Help with Billing?</h2>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                    Have questions about your subscription, invoices, or payment methods? We're here to help!
                </p>
                <a
                    href="https://wa.me/27736538207?text=Hi,%20I%20need%20help%20with%20billing%20for%20StockFlow"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors"
                >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Contact Billing Support via WhatsApp
                </a>
            </div>
        </div>
    );
};

export default BillingView;

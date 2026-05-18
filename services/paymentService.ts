// Payment Service - Foundation for Stripe/PayFast Integration
import { Organization } from '../types';

// Payment processor configuration
interface PaymentConfig {
  provider: 'whatsapp' | 'stripe' | 'payfast' | 'none';
  publicKey?: string;
  isConfigured: boolean;
}

// Get payment configuration from environment
// Default to WhatsApp-based payment flow
export const getPaymentConfig = (): PaymentConfig => {
  // WhatsApp is the default (always configured)
  return {
    provider: 'whatsapp',
    isConfigured: true
  };
};

// Plan pricing configuration
export const PLAN_PRICING = {
  Free: {
    monthlyPrice: 0,
    currency: 'ZAR',
    stripePriceId: '', // Add your Stripe price ID here
    payfastItemName: 'StockFlow Free Plan'
  },
  Pro: {
    monthlyPrice: 199,
    currency: 'ZAR',
    stripePriceId: '', // Add your Stripe price ID here
    payfastItemName: 'StockFlow Pro Plan'
  },
  Enterprise: {
    monthlyPrice: null, // Custom pricing
    currency: 'ZAR',
    stripePriceId: '', // Add your Stripe price ID here
    payfastItemName: 'StockFlow Enterprise Plan'
  }
};

// Initialize payment processor
export const initializePayment = async (plan: string, organizationId: string): Promise<void> => {
  const config = getPaymentConfig();
  
  if (!config.isConfigured) {
    throw new Error('Payment processor not configured.');
  }
  
  switch (config.provider) {
    case 'whatsapp':
      return initializeWhatsAppPayment(plan, organizationId);
    case 'stripe':
      return initializeStripePayment(plan, organizationId);
    case 'payfast':
      return initializePayFastPayment(plan, organizationId);
    default:
      throw new Error('No payment processor configured');
  }
};

// WhatsApp payment flow — opens WhatsApp with pre-filled message
const WHATSAPP_BILLING_NUMBER = '27736538207';

const initializeWhatsAppPayment = async (plan: string, organizationId: string): Promise<void> => {
  const pricing = PLAN_PRICING[plan as keyof typeof PLAN_PRICING];
  if (!pricing) throw new Error(`Unknown plan: ${plan}`);

  const message = encodeURIComponent(
    `Hi, I'd like to subscribe to the StockFlow ${plan} Plan (${pricing.currency} ${pricing.monthlyPrice}/mo).\n\nOrganization ID: ${organizationId}\n\nPlease send me the payment details.`
  );
  window.open(`https://wa.me/${WHATSAPP_BILLING_NUMBER}?text=${message}`, '_blank', 'noopener,noreferrer');
};

// Stripe integration (requires @stripe/stripe-js)
const initializeStripePayment = async (plan: string, organizationId: string): Promise<void> => {
  try {
    // TODO: Uncomment when Stripe is installed and configured
    /*
    const { loadStripe } = await import('@stripe/stripe-js');
    const stripe = await loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
    
    if (!stripe) {
      throw new Error('Failed to load Stripe');
    }
    
    // Create checkout session
    const response = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        priceId: PLAN_PRICING[plan].stripePriceId,
        organizationId: organizationId,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to create checkout session');
    }
    
    const { sessionId } = await response.json();
    
    // Redirect to Stripe Checkout
    const { error } = await stripe.redirectToCheckout({ sessionId });
    
    if (error) {
      throw new Error(error.message);
    }
    */
    
    throw new Error('Stripe integration not yet implemented. Please install @stripe/stripe-js and configure the backend.');
  } catch (error) {
    console.error('Stripe payment initialization failed:', error);
    throw error;
  }
};

// PayFast integration
const initializePayFastPayment = async (plan: string, organizationId: string): Promise<void> => {
  try {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    const response = await fetch(`${serverUrl}/api/billing/payfast/create-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan: plan,
        organizationId: organizationId,
        amount: PLAN_PRICING[plan].monthlyPrice,
        itemName: PLAN_PRICING[plan].payfastItemName
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to create PayFast subscription');
    }
    
    const { formData, actionUrl } = await response.json();
    
    // Create and submit PayFast form
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = actionUrl;
    form.style.display = 'none';
    
    // Add all form fields
    Object.keys(formData).forEach(key => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = formData[key];
      form.appendChild(input);
    });
    
    // Add form to page and submit
    document.body.appendChild(form);
    form.submit();
    
  } catch (error) {
    console.error('PayFast payment initialization failed:', error);
    throw error;
  }
};

// Cancel subscription
export const cancelSubscription = async (organizationId: string): Promise<void> => {
  const config = getPaymentConfig();
  
  if (!config.isConfigured) {
    console.warn('No payment processor configured, simulating cancellation');
    return;
  }
  
  try {
    const response = await fetch('/api/billing/cancel-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: organizationId,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to cancel subscription');
    }
  } catch (error) {
    console.error('Subscription cancellation failed:', error);
    throw error;
  }
};

// Get billing history
export const getBillingHistory = async (organizationId: string): Promise<any[]> => {
  const config = getPaymentConfig();
  
  if (!config.isConfigured) {
    return []; // Return empty array if no payment processor
  }
  
  try {
    const response = await fetch(`/api/billing/history/${organizationId}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch billing history');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch billing history:', error);
    return [];
  }
};

// Validate subscription status
export const validateSubscription = async (organizationId: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/billing/validate/${organizationId}`);
    
    if (!response.ok) {
      return false;
    }
    
    const { isValid } = await response.json();
    return isValid;
  } catch (error) {
    console.error('Subscription validation failed:', error);
    return false;
  }
};

// Enforce usage limits based on subscription
export const enforceUsageLimits = (
  organization: Organization, 
  currentUsage: { users: number; items: number }
): { canAddUsers: boolean; canAddItems: boolean; limitReached: string | null } => {
  const limits = {
    Free: { users: 1, items: 50 },
    Pro: { users: 10, items: 1000 },
    Enterprise: { users: Infinity, items: Infinity }
  };
  
  const planLimits = limits[organization.subscription?.plan || 'Free'];
  
  return {
    canAddUsers: currentUsage.users < planLimits.users,
    canAddItems: currentUsage.items < planLimits.items,
    limitReached: 
      currentUsage.users >= planLimits.users ? 'users' :
      currentUsage.items >= planLimits.items ? 'items' :
      null
  };
};

export default {
  getPaymentConfig,
  initializePayment,
  cancelSubscription,
  getBillingHistory,
  validateSubscription,
  enforceUsageLimits,
  PLAN_PRICING
};
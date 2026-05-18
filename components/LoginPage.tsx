import React, { useState, useEffect } from 'react';
import { auth, isFirebaseInitialized } from '../services/firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  // GoogleAuthProvider, 
  // signInWithRedirect,
  // getRedirectResult,
  sendPasswordResetEmail 
} from 'firebase/auth';
import { createOrganizationAndUser, clearAllLocalData, getUserData } from '../services/apiService';
import { useToast } from '../hooks/useToast';

// const GoogleIcon = () => (
//   <svg className="w-5 h-5" viewBox="0 0 48 48">
//     <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
//     <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
//     <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.222,0-9.519-3.486-11.187-8.26l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
//     <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.574l6.19,5.238C39.99,35.508,44,30.021,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
//   </svg>
// );

const FirebaseNotConfigured: React.FC = () => (
  <div className="w-full max-w-md p-8 space-y-4 bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
    <div className="text-center">
      <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 mx-auto text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <h2 className="mt-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Configuration Needed
      </h2>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        Your Firebase credentials are not set up correctly.
      </p>
    </div>
    <div className="p-4 mt-4 bg-yellow-100 dark:bg-yellow-900/50 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
      <p><strong>Action Required:</strong> To enable authentication, please add your Firebase project's configuration details to the following file:</p>
      <code className="block p-2 mt-2 font-mono text-xs bg-gray-200 dark:bg-gray-700 rounded">
        services/firebase.ts
      </code>
    </div>
  </div>
);

// GOOGLE AUTH DISABLED - GoogleProfileSetup component commented out
/*
interface GoogleProfileSetupProps {
  userInfo: { email: string; name: string; uid: string };
  onComplete: () => void;
  onCancel: () => void;
}

const GoogleProfileSetup: React.FC<GoogleProfileSetupProps> = ({ userInfo, onComplete, onCancel }) => {
  const [orgName, setOrgName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const addToast = useToast();

  const handleSetupProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!orgName.trim()) {
      addToast('Please enter your organization name', 'error');
      return;
    }

    setIsLoading(true);
    
    try {
      await createOrganizationAndUser({
        name: userInfo.name,
        email: userInfo.email,
        orgName: orgName.trim(),
        uid: userInfo.uid
      });
      
      // Set onboarding as completed for new organization
      localStorage.setItem('onboardingCompleted', 'true');
      
      addToast(`🎉 Welcome to StockFlow! Organization '${orgName}' created successfully.`, 'success');
      onComplete();
    } catch (error: any) {
      console.error('Error creating organization:', error);
      addToast(`Failed to create organization: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-transparent rounded-full flex items-center justify-center">
          <img src="/image/stockflow logo.png" alt="StockFlow logo" className="w-14 h-14 object-contain" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Complete Your Profile
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Welcome {userInfo.name}! Please provide your organization details.
        </p>
      </div>

      <form onSubmit={handleSetupProfile} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Email (from Google)
          </label>
          <input
            id="email"
            type="email"
            value={userInfo.email}
            disabled
            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400"
          />
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Full Name (from Google)
          </label>
          <input
            id="name"
            type="text"
            value={userInfo.name}
            disabled
            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400"
          />
        </div>

        <div>
          <label htmlFor="orgName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Organization Name *
          </label>
          <input
            id="orgName"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g., Omegatek, My Company Ltd"
            required
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            This will be your company's workspace. You can add team members later.
          </p>
        </div>

        <div className="flex space-x-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 dark:bg-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading || !orgName.trim()}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating...
              </>
            ) : (
              'Create Organization'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
*/

const LoginPage: React.FC = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  // const [googleUserNeedsProfile, setGoogleUserNeedsProfile] = useState<{email: string, name: string, uid: string} | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [inviteInfo, setInviteInfo] = useState<{orgName: string} | null>(null);
  const addToast = useToast();

  // // Handle Google Sign-In redirect result on component mount
  // useEffect(() => {
  //   const handleRedirectResult = async () => {
  //     if (!auth) return;
      
  //     try {
  //       const result = await getRedirectResult(auth);
        
  //       if (result && result.user) {
  //         const user = result.user;
          
  //         if (!user.email || !user.displayName) {
  //           throw new Error('Unable to get required information from Google account');
  //         }

  //         // Check if this is a new user who needs organization setup
  //         setGoogleUserNeedsProfile({
  //           email: user.email,
  //           name: user.displayName,
  //           uid: user.uid
  //         });
  //         sessionStorage.removeItem('googleRedirectInProgress');
  //         return;
  //       }
  //     } catch (error: any) {
  //       console.error('Google redirect error:', error);
        
  //       if (error.code === 'auth/no-auth-event') {
  //         sessionStorage.removeItem('googleRedirectInProgress');
  //         return;
  //       }

  //       if (error.code !== 'auth/popup-closed-by-user') {
  //         addToast(`Google sign-in failed: ${error.message}`, 'error');
  //       }
  //     }

  //     // If we reach here and there was an in-progress redirect, clear the flag
  //     if (sessionStorage.getItem('googleRedirectInProgress')) {
  //       sessionStorage.removeItem('googleRedirectInProgress');
  //     }
  //   };

  //   handleRedirectResult();
  // }, [addToast]);

  // Invite pre-detection requires authentication and cannot run before signup.
  // Invite lookup is performed after Firebase auth creation inside handleEmailAuth.

  // Don't clear data automatically - let users keep their settings

  if (!isFirebaseInitialized()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 px-4">
        <FirebaseNotConfigured />
      </div>
    );
  }

  // // Show Google profile setup if needed - COMMENTED OUT
  // if (googleUserNeedsProfile) {
  //   return (
  //     <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 px-4 relative">
  //       <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
  //         <source src="/image/SCAN.mp4" type="video/mp4" />
  //         <source src="/image/SCAN.webm" type="video/webm" />
  //         Your browser does not support the video tag.
  //       </video>
  //       <div className="absolute inset-0 bg-[rgba(31,17,55,0.45)] backdrop-blur-sm" style={{mixBlendMode: 'multiply'}} />
  //       <GoogleProfileSetup
  //         userInfo={googleUserNeedsProfile}
  //         onComplete={() => {
  //           setGoogleUserNeedsProfile(null);
  //           // Clear all localStorage view tracking for fresh start
  //           localStorage.removeItem('currentView');
  //           localStorage.removeItem('pendingView');
  //           window.location.reload(); // Reload to initialize with new organization
  //         }}
  //         onCancel={async () => {
  //           if (auth?.currentUser) {
  //             await auth.signOut();
  //           }
  //           setGoogleUserNeedsProfile(null);
  //         }}
  //       />
  //     </div>
  //   );
  // }

  const validateForm = (): boolean => {
    if (!email.trim()) {
      addToast('Email is required', 'error');
      return false;
    }

    // FIX BUG-AUTH-004: Add email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      addToast('Please enter a valid email address', 'error');
      return false;
    }

    if (!password) {
      addToast('Password is required', 'error');
      return false;
    }

    if (isSignUp) {
      if (!name.trim()) {
        addToast('Full name is required', 'error');
        return false;
      }

      if (password.length < 6) {
        addToast('Password must be at least 6 characters', 'error');
        return false;
      }

      if (password !== confirmPassword) {
        addToast('Passwords do not match', 'error');
        return false;
      }
    }

    return true;
  };

  const handleRateLimit = () => {
    setIsRateLimited(true);
    setTimeout(() => setIsRateLimited(false), 60000); // 1 minute cooldown
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isRateLimited) {
      addToast('Please wait before trying again', 'error');
      return;
    }

    if (!validateForm()) return;

    setIsLoading(true);

    // ── Sign-in path ───────────────────────────────────────────────────────
    if (!isSignUp) {
      try {
        await signInWithEmailAndPassword(auth!, email.trim(), password);
        addToast('Welcome back! Signed in successfully.', 'success');
      } catch (error: any) {
        console.error('Sign-in error:', error);
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
          addToast('Invalid email or password. Please check your credentials and try again.', 'error');
        } else if (error.code === 'auth/too-many-requests') {
          addToast('Too many failed attempts. Please try again later.', 'error');
          handleRateLimit();
        } else {
          addToast(error.message || 'Sign-in failed. Please try again.', 'error');
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── Sign-up path ───────────────────────────────────────────────────────
    // CRITICAL ORDER: create Firebase auth FIRST, then do Firestore work.
    //
    // Reason 1 (invite detection): getUserByEmail() requires auth.currentUser —
    //   calling it before createUserWithEmailAndPassword always returns null,
    //   so invited users were silently routed to a fresh org creation.
    //
    // Reason 2 (orphaned accounts): if Firestore work fails after Firebase auth
    //   succeeds, the user ends up with an auth account but no org — they
    //   can't sign in (app signs them out) and can't re-signup (email taken).
    //   We delete the auth account in the catch block so they can retry cleanly.

    let userCredential: Awaited<ReturnType<typeof createUserWithEmailAndPassword>> | null = null;

    try {
      // Step 1: Create the Firebase auth account.
      userCredential = await createUserWithEmailAndPassword(auth!, email.trim(), password);

      localStorage.removeItem('currentView');
      localStorage.removeItem('pendingView');

      // Step 2: User is now authenticated — invite lookup will work.
      let invitedUser = null;
      try {
        const { getUserByEmail } = await import('../services/apiService');
        invitedUser = await getUserByEmail(email.toLowerCase().trim());
      } catch {
        // Firestore lookup failed — treat as no invite and continue.
      }

      if (invitedUser && invitedUser.user.invited) {
        // Step 3a: Invited path — activate the pre-created user record.
        const { updateUserInOrganization } = await import('../services/apiService');
        await updateUserInOrganization({
          ...invitedUser.user,
          uid: userCredential.user.uid,
          name: name.trim() || invitedUser.user.name,
          invited: false
        });
        setInviteInfo({ orgName: invitedUser.organization.name });
        addToast(`Welcome to ${invitedUser.organization.name}! Your account has been activated.`, 'success');
      } else {
        // Step 3b: New org path — validate orgName here since we now know they're not invited.
        if (!orgName.trim()) {
          addToast('Organization name is required', 'error');
          await userCredential!.user.delete();
          return;
        }
        await createOrganizationAndUser({
          name: name.trim(),
          email: email.toLowerCase().trim(),
          orgName: orgName.trim(),
          uid: userCredential.user.uid
        });
        addToast(`Welcome to StockFlow! Organization '${orgName}' created successfully.`, 'success');
      }

      // Allow Firestore replication to settle before the app reads user data.
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error: any) {
      console.error('Signup error:', error);

      // If the Firebase auth account was created but Firestore failed, delete the
      // auth account so the user is NOT permanently locked out (can re-signup).
      if (userCredential?.user) {
        try {
          await userCredential.user.delete();
          console.log('Cleaned up orphaned auth account after Firestore failure');
        } catch (deleteErr) {
          // If cleanup itself fails, log it but don't mask the original error.
          console.error('Failed to clean up orphaned auth account:', deleteErr);
        }
      }

      if (error.code === 'auth/email-already-in-use') {
        addToast('This email is already registered. Please sign in instead.', 'error');
        setIsSignUp(false);
      } else if (error.code === 'auth/weak-password') {
        addToast('Password is too weak. Please choose a stronger password.', 'error');
      } else if (error.code === 'auth/too-many-requests') {
        addToast('Too many failed attempts. Please try again later.', 'error');
        handleRateLimit();
      } else {
        addToast(error.message || 'Account setup failed. Please try again.', 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // const handleGoogleAuth = async () => {
  //   if (isRateLimited) {
  //     addToast('Please wait before trying again', 'error');
  //     return;
  //   }

  //   setIsLoading(true);

  //   const provider = new GoogleAuthProvider();
  //   provider.addScope('email');
  //   provider.addScope('profile');

  //   try {
  //     sessionStorage.setItem('googleRedirectInProgress', 'true');
  //     await signInWithRedirect(auth!, provider);
  //   } catch (error: any) {
  //     console.error('Google authentication error:', error);
  //     addToast(error.message || 'Google sign-in failed. Please try again.', 'error');
  //     setIsLoading(false);
  //   }
  // };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!resetEmail.trim()) {
      addToast('Please enter your email address', 'error');
      return;
    }

    setIsLoading(true);

    try {
      await sendPasswordResetEmail(auth!, resetEmail.trim());
      addToast('Password reset email sent! Check your inbox.', 'success');
      setShowForgotPassword(false);
      setResetEmail('');
    } catch (error: any) {
      console.error('Password reset error:', error);
      
      if (error.code === 'auth/user-not-found') {
        addToast('No account found with this email address.', 'error');
      } else {
        addToast('Failed to send reset email. Please try again.', 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (showForgotPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 px-4 relative">
        <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
          <source src="/image/SCAN.mp4" type="video/mp4" />
          <source src="/image/SCAN.webm" type="video/webm" />
          Your browser does not support the video tag.
        </video>
        <div className="absolute inset-0 bg-[rgba(31,17,55,0.45)] backdrop-blur-sm" style={{mixBlendMode: 'multiply'}} />
        <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-800 rounded-2xl shadow-lg z-10">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Reset Password
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Enter your email to receive a password reset link
            </p>
          </div>

          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label htmlFor="resetEmail" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email Address
              </label>
              <input
                id="resetEmail"
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="Enter your email"
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
              />
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                disabled={isLoading}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 dark:bg-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Back to Login
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Sending...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 px-4 relative">
      <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
        <source src="/image/SCAN.mp4" type="video/mp4" />
        <source src="/image/SCAN.webm" type="video/webm" />
        Your browser does not support the video tag.
      </video>
      <div className="absolute inset-0 bg-[rgba(31,17,55,0.45)] backdrop-blur-sm" style={{mixBlendMode: 'multiply'}} />
      <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-800 rounded-2xl shadow-lg z-10">
        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-transparent rounded-full flex items-center justify-center">
            <img src="/image/stockflow logo.png" alt="StockFlow logo" className="w-14 h-14 object-contain" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {isSignUp ? 'Create Organization' : 'Welcome Back'}
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {isSignUp 
              ? 'Set up your organization and start managing inventory' 
              : 'Sign in to your StockFlow dashboard'
            }
          </p>
        </div>

        {/* Google Sign In Button - COMMENTED OUT */}
        {/* <button
          onClick={handleGoogleAuth}
          disabled={isLoading || isRateLimited}
          className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm bg-white dark:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <GoogleIcon />
          <span className="ml-3">
            {isSignUp ? 'Sign up with Google' : 'Sign in with Google'}
          </span>
        </button> */}

        {/* Divider - COMMENTED OUT SINCE GOOGLE BUTTON IS REMOVED */}
        {/* <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-600" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">Or continue with email</span>
          </div>
        </div> */}

        {/* Email Form */}
        <form onSubmit={handleEmailAuth} className="space-y-4">
          {isSignUp && (
            <>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                />
              </div>

              {!inviteInfo && (
                <div>
                  <label htmlFor="orgName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Organization Name
                  </label>
                  <input
                    id="orgName"
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g., Omegatek, My Company Ltd"
                    required
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    This will be your company's workspace
                  </p>
                </div>
              )}
            </>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@company.com"
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
            />
            {inviteInfo && (
              <p className="mt-1 text-sm text-green-600 dark:text-green-400">
                ✨ You're invited to join <strong>{inviteInfo.orgName}</strong>!
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          {isSignUp && (
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || isRateLimited}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {isSignUp ? 'Creating Organization...' : 'Signing In...'}
              </>
            ) : (
              isSignUp ? 'Create Organization' : 'Sign In'
            )}
          </button>
        </form>

        {/* Footer Links */}
        <div className="text-center space-y-2">
          {!isSignUp && (
            <button
              onClick={() => setShowForgotPassword(true)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300"
            >
              Forgot your password?
            </button>
          )}
          
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {isSignUp ? "Already have an organization? " : "Don't have an organization? "}
            </span>
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setEmail('');
                setPassword('');
                setConfirmPassword('');
                setName('');
                setOrgName('');
              }}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300"
            >
              {isSignUp ? 'Sign in here' : 'Create one here'}
            </button>
          </div>
        </div>

        {isRateLimited && (
          <div className="text-center">
            <p className="text-sm text-red-600 dark:text-red-400">
              Rate limited. Please wait 60 seconds before trying again.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
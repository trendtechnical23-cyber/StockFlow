import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { activityLogger } from '../services/activityLogger';
import { User, Settings, UserRole, ZohoSyncSettings, NotificationSettings } from '../types';
import UserManagementModal from '../components/UserManagementModal';
import ConfirmationModal from '../components/ConfirmationModal';
import { useToast } from '../hooks/useToast';
import { requestDataExport, requestDataDeletion, updateOrganizationAPI, updateUserInOrganization, updateOrganizationSettings } from '../services/apiService';
import { auth } from '../services/firebase';
import { updateProfile, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';

const APP_VERSION = '1.2.1';

const SettingsView: React.FC = () => {
    const { state, dispatch, handleUpdateUser, handleDeleteUser, handleDeleteAllData } = useAppContext();
    const { settings, currentUser, users, currentOrganization } = state;
    const addToast = useToast();

    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

    // Profile editing states
    const [profileData, setProfileData] = useState({
        name: currentUser.name,
        email: currentUser.email
    });
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);

    // Password change states
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [showPasswordForm, setShowPasswordForm] = useState(false);

    // Organization settings
    const [orgData, setOrgData] = useState({ name: currentOrganization.name });
    const [isEditingOrg, setIsEditingOrg] = useState(false);
    const [isSavingOrg, setIsSavingOrg] = useState(false);

    // Risk threshold (stock take financial control)
    const [riskThreshold, setRiskThreshold] = useState<number>(
        (currentOrganization as any).stockTakeSettings?.riskThresholdRands ?? 5000
    );
    const [isSavingRiskThreshold, setIsSavingRiskThreshold] = useState(false);

    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [userToDelete, setUserToDelete] = useState<User | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteAllDataModal, setShowDeleteAllDataModal] = useState(false);

    // ─── Broadcast a notification to all org members for admin-level changes ───
    const broadcastOrgNotification = async (title: string, message: string) => {
        try {
            const { notificationService } = await import('../services/notificationService');
            await notificationService.notifySystem(currentOrganization.id, title, message);
        } catch (err) {
            console.warn('Failed to broadcast notification:', err);
        }
    };

    // ─── Theme ────────────────────────────────────────────────────────────────
    const handleThemeChange = async (newTheme: 'light' | 'dark') => {
        const previous = settings.theme;
        if (previous === newTheme) return;
        dispatch({ type: 'UPDATE_SETTINGS', payload: { theme: newTheme } });
        addToast({ message: `Theme changed to ${newTheme}`, type: 'success' });
        try {
            await activityLogger.log(currentOrganization.id, {
                action: 'CHANGE_THEME',
                category: 'SETTINGS',
                severity: 'LOW',
                description: `Changed theme from "${previous}" to "${newTheme}"`,
                targetType: 'setting',
                targetName: 'theme',
                previousValue: previous,
                newValue: newTheme,
                metadata: { version: APP_VERSION }
            });
        } catch (logErr) {
            console.warn('Failed to log theme change:', logErr);
        }
    };

    // ─── Low stock threshold ──────────────────────────────────────────────────
    const handleLowStockThresholdChange = async (value: number) => {
        const previous = settings.lowStockThreshold;
        dispatch({ type: 'UPDATE_SETTINGS', payload: { lowStockThreshold: value } });
        addToast({ message: 'Low stock threshold updated', type: 'success' });
        // Persist to org-level Firestore settings
        try {
            await updateOrganizationSettings(currentOrganization.id, {
                lowStockThreshold: value
            });
        } catch (err) {
            console.warn('Failed to persist low stock threshold:', err);
        }
        // Audit trail
        try {
            await activityLogger.log(currentOrganization.id, {
                action: 'CHANGE_LOW_STOCK_THRESHOLD',
                category: 'SETTINGS',
                severity: 'MEDIUM',
                description: `Changed default low stock threshold from ${previous} to ${value} units`,
                targetType: 'setting',
                targetName: 'lowStockThreshold',
                previousValue: previous,
                newValue: value,
                metadata: { version: APP_VERSION }
            });
        } catch (logErr) {
            console.warn('Failed to log threshold change:', logErr);
        }
        // Notify org members
        await broadcastOrgNotification(
            'Low Stock Threshold Updated',
            `${currentUser.name || currentUser.email} changed the default low stock threshold from ${previous} to ${value} units`
        );
    };

    // ─── Notification preferences ─────────────────────────────────────────────
    const handleNotificationSettingsChange = async (field: keyof NotificationSettings, value: any) => {
        const previous = settings.notificationSettings[field];
        const newNotificationSettings = { ...settings.notificationSettings, [field]: value };
        dispatch({ type: 'UPDATE_SETTINGS', payload: { notificationSettings: newNotificationSettings } });
        addToast({ message: 'Notification preferences saved', type: 'success' });
        // Persist per-user to Firestore
        try {
            await updateUserInOrganization({
                ...currentUser,
                savedNotificationSettings: newNotificationSettings
            });
        } catch (err) {
            console.warn('Failed to persist notification settings:', err);
        }
        // Audit trail
        try {
            await activityLogger.log(currentOrganization.id, {
                action: 'CHANGE_NOTIFICATION_SETTINGS',
                category: 'SETTINGS',
                severity: 'LOW',
                description: `Changed notification preference "${field}" from ${JSON.stringify(previous)} to ${JSON.stringify(value)}`,
                targetType: 'setting',
                targetName: `notificationSettings.${field}`,
                previousValue: previous,
                newValue: value,
                metadata: { version: APP_VERSION }
            });
        } catch (logErr) {
            console.warn('Failed to log notification settings change:', logErr);
        }
    };

    // ─── Analytics settings ───────────────────────────────────────────────────
    const handleAnalyticsChange = async (field: 'autoRefresh' | 'refreshInterval', value: any) => {
        const previous = (settings.analytics as any)?.[field];
        const newAnalytics = { ...settings.analytics, [field]: value };
        dispatch({ type: 'UPDATE_SETTINGS', payload: { analytics: newAnalytics } });
        addToast({ message: 'Dashboard analytics settings saved', type: 'success' });
        // Persist per-user to Firestore
        try {
            await updateUserInOrganization({
                ...currentUser,
                savedAnalyticsSettings: newAnalytics
            });
        } catch (err) {
            console.warn('Failed to persist analytics settings:', err);
        }
        // Audit trail
        try {
            await activityLogger.log(currentOrganization.id, {
                action: 'CHANGE_ANALYTICS_SETTINGS',
                category: 'SETTINGS',
                severity: 'LOW',
                description: `Changed analytics "${field}" from ${JSON.stringify(previous)} to ${JSON.stringify(value)}`,
                targetType: 'setting',
                targetName: `analytics.${field}`,
                previousValue: previous,
                newValue: value,
                metadata: { version: APP_VERSION }
            });
        } catch (logErr) {
            console.warn('Failed to log analytics change:', logErr);
        }
    };

    // ─── Zoho sync settings ───────────────────────────────────────────────────
    const handleZohoSettingsChange = async (field: keyof ZohoSyncSettings, value: any) => {
        const previous = (settings.zohoSync as any)?.[field];
        const newZohoSync = { ...settings.zohoSync, [field]: value };
        dispatch({ type: 'UPDATE_SETTINGS', payload: { zohoSync: newZohoSync } });
        addToast({ message: 'Zoho sync settings saved', type: 'success' });
        // Audit trail
        try {
            await activityLogger.log(currentOrganization.id, {
                action: 'CHANGE_ZOHO_SETTINGS',
                category: 'SETTINGS',
                severity: 'MEDIUM',
                description: `Changed Zoho sync "${field}" from ${JSON.stringify(previous)} to ${JSON.stringify(value)}`,
                targetType: 'setting',
                targetName: `zohoSync.${field}`,
                previousValue: previous,
                newValue: value,
                metadata: { version: APP_VERSION }
            });
        } catch (logErr) {
            console.warn('Failed to log Zoho settings change:', logErr);
        }
    };

    // ─── Risk threshold ───────────────────────────────────────────────────────
    const handleRiskThresholdSave = async () => {
        if (isNaN(riskThreshold) || riskThreshold < 0) {
            addToast({ message: 'Please enter a valid threshold amount', type: 'error' });
            return;
        }
        const previousThreshold = (currentOrganization as any).stockTakeSettings?.riskThresholdRands ?? 5000;
        setIsSavingRiskThreshold(true);
        try {
            const updated = {
                ...currentOrganization,
                stockTakeSettings: { riskThresholdRands: riskThreshold },
            };
            await updateOrganizationAPI(currentOrganization.id, { stockTakeSettings: { riskThresholdRands: riskThreshold } } as any);
            dispatch({ type: 'UPDATE_ORGANIZATION', payload: updated });
            addToast({ message: 'Risk threshold saved!', type: 'success' });
            // Audit trail
            await activityLogger.log(currentOrganization.id, {
                action: 'CHANGE_RISK_THRESHOLD',
                category: 'SETTINGS',
                severity: 'HIGH',
                description: `Changed stock-take high-risk threshold from R${previousThreshold.toLocaleString()} to R${riskThreshold.toLocaleString()}`,
                targetType: 'setting',
                targetName: 'stockTakeSettings.riskThresholdRands',
                previousValue: previousThreshold,
                newValue: riskThreshold,
                metadata: { version: APP_VERSION }
            });
            // Notify all org members — this is a financial control change
            await broadcastOrgNotification(
                'Risk Threshold Updated',
                `${currentUser.name || currentUser.email} changed the stock-take high-risk threshold from R${previousThreshold.toLocaleString()} to R${riskThreshold.toLocaleString()}`
            );
        } catch {
            addToast({ message: 'Failed to save risk threshold', type: 'error' });
        } finally {
            setIsSavingRiskThreshold(false);
        }
    };

    // ─── Profile ──────────────────────────────────────────────────────────────
    const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProfileData({ ...profileData, [e.target.name]: e.target.value });
    };

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPasswordData({ ...passwordData, [e.target.name]: e.target.value });
    };

    const handleOrgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setOrgData({ ...orgData, [e.target.name]: e.target.value });
    };

    const handleProfileSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSavingProfile(true);

        try {
            if (!auth.currentUser) throw new Error('No authenticated user found');

            if (profileData.name !== currentUser.name) {
                await activityLogger.logNameChange(
                    currentOrganization.id,
                    'user',
                    currentUser.email,
                    currentUser.name || 'Unknown',
                    profileData.name
                );
                await updateProfile(auth.currentUser, { displayName: profileData.name });
            }

            if (profileData.email !== currentUser.email) {
                await activityLogger.log(currentOrganization.id, {
                    action: 'CHANGE_USER_EMAIL',
                    category: 'USER_MANAGEMENT',
                    severity: 'MEDIUM',
                    description: `Changed email from ${currentUser.email} to ${profileData.email}`,
                    targetType: 'user',
                    targetName: currentUser.email,
                    previousValue: currentUser.email,
                    newValue: profileData.email,
                    metadata: { version: APP_VERSION }
                });
                await updateEmail(auth.currentUser, profileData.email);
            }

            await handleUpdateUser({ ...currentUser, ...profileData });

            setIsEditingProfile(false);
            addToast({ message: 'Profile updated successfully!', type: 'success' });
        } catch (error: any) {
            if (error.code === 'auth/requires-recent-login') {
                addToast({
                    message: 'For security, please log out and log back in to update your email.',
                    type: 'error'
                });
            } else {
                addToast({ message: error.message || 'Failed to update profile', type: 'error' });
            }
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handlePasswordSave = async (e: React.FormEvent) => {
        e.preventDefault();

        if (passwordData.newPassword !== passwordData.confirmPassword) {
            addToast({ message: 'New passwords do not match', type: 'error' });
            return;
        }
        if (passwordData.newPassword.length < 6) {
            addToast({ message: 'Password must be at least 6 characters long', type: 'error' });
            return;
        }

        setIsChangingPassword(true);

        try {
            if (!auth.currentUser) throw new Error('No authenticated user found');

            const credential = EmailAuthProvider.credential(
                auth.currentUser.email!,
                passwordData.currentPassword
            );
            await reauthenticateWithCredential(auth.currentUser, credential);
            await updatePassword(auth.currentUser, passwordData.newPassword);

            // Audit trail for password change (HIGH severity — security event)
            try {
                await activityLogger.log(currentOrganization.id, {
                    action: 'CHANGE_PASSWORD',
                    category: 'AUTHENTICATION',
                    severity: 'HIGH',
                    description: `User ${currentUser.email} changed their password`,
                    targetType: 'user',
                    targetName: currentUser.email,
                    metadata: { version: APP_VERSION }
                });
            } catch (logErr) {
                console.warn('Failed to log password change:', logErr);
            }

            setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setShowPasswordForm(false);
            addToast({ message: 'Password updated successfully!', type: 'success' });
        } catch (error: any) {
            if (error.code === 'auth/wrong-password') {
                addToast({ message: 'Current password is incorrect', type: 'error' });
            } else {
                addToast({ message: error.message || 'Failed to update password', type: 'error' });
            }
        } finally {
            setIsChangingPassword(false);
        }
    };

    // ─── User management ──────────────────────────────────────────────────────
    const handleOpenUserModal = (user: User | null) => {
        setSelectedUser(user);
        setIsUserModalOpen(true);
    };

    const handleDeleteClick = (user: User) => {
        setUserToDelete(user);
        setIsConfirmOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (userToDelete) {
            setIsDeleting(true);
            await handleDeleteUser(userToDelete.uid);
            setIsDeleting(false);
            setIsConfirmOpen(false);
            setUserToDelete(null);
        }
    };

    // ─── Organization ─────────────────────────────────────────────────────────
    const handleOrgSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSavingOrg(true);

        try {
            const previousName = currentOrganization.name;

            if (orgData.name !== previousName) {
                await activityLogger.logNameChange(
                    currentOrganization.id,
                    'organization',
                    currentOrganization.name,
                    previousName,
                    orgData.name
                );
            }

            await updateOrganizationAPI(currentOrganization.id, orgData);
            dispatch({ type: 'UPDATE_ORGANIZATION', payload: { ...currentOrganization, ...orgData } });

            setIsEditingOrg(false);
            addToast({ message: 'Organization updated successfully!', type: 'success' });

            if (orgData.name !== previousName) {
                await broadcastOrgNotification(
                    'Organization Renamed',
                    `${currentUser.name || currentUser.email} renamed the organization from "${previousName}" to "${orgData.name}"`
                );
            }
        } catch (error: any) {
            addToast({ message: 'Failed to update organization', type: 'error' });
        } finally {
            setIsSavingOrg(false);
        }
    };

    // ─── Data & privacy ───────────────────────────────────────────────────────
    const handleDataExport = async () => {
        addToast({ message: 'Requesting data export… You will receive an email shortly.', type: 'info' });
        try {
            await requestDataExport(currentUser.uid);
            await activityLogger.log(currentOrganization.id, {
                action: 'REQUEST_DATA_EXPORT',
                category: 'SETTINGS',
                severity: 'LOW',
                description: `User ${currentUser.email} requested a data export`,
                targetType: 'user',
                targetName: currentUser.email,
                metadata: { version: APP_VERSION }
            });
        } catch (err) {
            console.warn('Data export request failed:', err);
        }
    };

    const handleDataDelete = async () => {
        addToast({ message: 'Requesting account deletion… A confirmation email will be sent.', type: 'info' });
        try {
            await requestDataDeletion(currentUser.uid);
            await activityLogger.log(currentOrganization.id, {
                action: 'REQUEST_ACCOUNT_DELETION',
                category: 'SETTINGS',
                severity: 'CRITICAL',
                description: `User ${currentUser.email} requested account deletion`,
                targetType: 'user',
                targetName: currentUser.email,
                metadata: { version: APP_VERSION }
            });
        } catch (err) {
            console.warn('Account deletion request failed:', err);
        }
    };

    const handleDeleteAllDataConfirm = async () => {
        try {
            await activityLogger.log(currentOrganization.id, {
                action: 'CLEAR_ALL_INVENTORY_DATA',
                category: 'SETTINGS',
                severity: 'CRITICAL',
                description: `Admin ${currentUser.email} cleared all inventory data (${state.inventory.length} items, ${state.activityLogs.length} logs)`,
                targetType: 'organization',
                targetName: currentOrganization.name,
                metadata: { version: APP_VERSION, itemCount: state.inventory.length, logCount: state.activityLogs.length }
            });
            await handleDeleteAllData();
            setShowDeleteAllDataModal(false);
        } catch (error) {
            addToast({ message: 'Failed to delete organization data. Please try again.', type: 'error' });
        }
    };

    const handleCancelProfileEdit = () => {
        setProfileData({ name: currentUser.name, email: currentUser.email });
        setIsEditingProfile(false);
    };

    const handleCancelOrgEdit = () => {
        setOrgData({ name: currentOrganization.name });
        setIsEditingOrg(false);
    };

    const handleCancelPasswordChange = () => {
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setShowPasswordForm(false);
    };

    return (
        <div className="space-y-8 max-w-4xl mx-auto">
            <div className="flex items-baseline justify-between">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
                <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">v{APP_VERSION}</span>
            </div>

            {/* User Profile */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">User Profile</h2>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: MEDIUM — changes are audited</p>
                    </div>
                    {!isEditingProfile && (
                        <button
                            onClick={() => setIsEditingProfile(true)}
                            className="px-3 py-1 text-sm bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-md hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                        >
                            Edit Profile
                        </button>
                    )}
                </div>

                {isEditingProfile ? (
                    <form onSubmit={handleProfileSave} className="space-y-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Display Name</label>
                            <input
                                type="text" name="name" id="name"
                                value={profileData.name} onChange={handleProfileChange} required
                                className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Email Address</label>
                            <input
                                type="email" name="email" id="email"
                                value={profileData.email} onChange={handleProfileChange} required
                                className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>
                        <div className="flex justify-end space-x-3">
                            <button type="button" onClick={handleCancelProfileEdit} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">Cancel</button>
                            <button type="submit" disabled={isSavingProfile} className="px-4 py-2 text-sm bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                {isSavingProfile ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">Display Name</label>
                            <p className="mt-1 text-gray-900 dark:text-white">{currentUser.name}</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">Email Address</label>
                            <p className="mt-1 text-gray-900 dark:text-white">{currentUser.email}</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">Role</label>
                            <span className={`inline-block mt-1 px-2 py-1 text-xs font-semibold rounded-full ${currentUser.role === UserRole.Admin ? 'bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200' : 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200'}`}>
                                {currentUser.role}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Security Settings */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">Security Settings</h2>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: HIGH — password changes are audited</p>
                    </div>
                    {!showPasswordForm && (
                        <button
                            onClick={() => setShowPasswordForm(true)}
                            className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                        >
                            Change Password
                        </button>
                    )}
                </div>

                {showPasswordForm ? (
                    <form onSubmit={handlePasswordSave} className="space-y-4">
                        <div>
                            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Current Password</label>
                            <input type="password" name="currentPassword" id="currentPassword" value={passwordData.currentPassword} onChange={handlePasswordChange} required className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                        </div>
                        <div>
                            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-500 dark:text-gray-400">New Password</label>
                            <input type="password" name="newPassword" id="newPassword" value={passwordData.newPassword} onChange={handlePasswordChange} required minLength={6} className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                        </div>
                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Confirm New Password</label>
                            <input type="password" name="confirmPassword" id="confirmPassword" value={passwordData.confirmPassword} onChange={handlePasswordChange} required minLength={6} className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                        </div>
                        <div className="flex justify-end space-x-3">
                            <button type="button" onClick={handleCancelPasswordChange} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">Cancel</button>
                            <button type="submit" disabled={isChangingPassword} className="px-4 py-2 text-sm bg-red-600 text-white font-semibold rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                {isChangingPassword ? 'Updating...' : 'Update Password'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Use the button above to change your password. Re-authentication is required for security.</p>
                )}
            </div>

            {/* Organization Settings (Admin only) */}
            {currentUser.role === UserRole.Admin && (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                    <div className="flex justify-between items-center mb-4">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">Organization Settings</h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: MEDIUM — notifies all members</p>
                        </div>
                        {!isEditingOrg && (
                            <button onClick={() => setIsEditingOrg(true)} className="px-3 py-1 text-sm bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-md hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors">
                                Edit Organization
                            </button>
                        )}
                    </div>

                    {isEditingOrg ? (
                        <form onSubmit={handleOrgSave} className="space-y-4">
                            <div>
                                <label htmlFor="orgName" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Organization Name</label>
                                <input type="text" name="name" id="orgName" value={orgData.name} onChange={handleOrgChange} required className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                            </div>
                            <div className="flex justify-end space-x-3">
                                <button type="button" onClick={handleCancelOrgEdit} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">Cancel</button>
                                <button type="submit" disabled={isSavingOrg} className="px-4 py-2 text-sm bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                    {isSavingOrg ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">Organization Name</label>
                                <p className="mt-1 text-gray-900 dark:text-white">{currentOrganization.name}</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">Subscription Plan</label>
                                <span className="inline-block mt-1 px-2 py-1 text-xs font-semibold rounded-full bg-green-200 dark:bg-green-900 text-green-800 dark:text-green-200">
                                    {currentOrganization.subscription.plan}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* General Preferences */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="mb-4">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">General Preferences</h2>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: LOW–MEDIUM — persisted per user and to Firestore</p>
                </div>
                <div className="space-y-5">
                    {/* Theme */}
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Theme</label>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Saved to your profile — persists across devices</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleThemeChange('light')}
                                className={`px-3 py-1 text-sm rounded-md transition-colors ${settings.theme === 'light' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
                            >
                                Light
                            </button>
                            <button
                                onClick={() => handleThemeChange('dark')}
                                className={`px-3 py-1 text-sm rounded-md transition-colors ${settings.theme === 'dark' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
                            >
                                Dark
                            </button>
                        </div>
                    </div>

                    {/* Low Stock Threshold */}
                    <div className="flex items-center justify-between">
                        <div>
                            <label htmlFor="lowStockThreshold" className="text-sm font-medium text-gray-700 dark:text-gray-300">Default Low Stock Threshold</label>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Applied to new items — org-level, notifies all members</p>
                        </div>
                        <input
                            type="number" id="lowStockThreshold"
                            value={settings.lowStockThreshold}
                            min={0}
                            onChange={e => handleLowStockThresholdChange(parseInt(e.target.value, 10) || 0)}
                            className="w-24 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md py-1 px-2 text-gray-900 dark:text-white text-sm"
                        />
                    </div>
                </div>
            </div>

            {/* Notification Preferences */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="mb-4">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">Notification Preferences</h2>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: LOW — persisted to your user profile in Firestore</p>
                </div>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="text-sm">
                            <p className="font-medium text-gray-700 dark:text-gray-300">Low Stock Notifications</p>
                            <p className="text-gray-500 dark:text-gray-400">In-app and email alerts for items that need restocking</p>
                        </div>
                        <button
                            onClick={() => handleNotificationSettingsChange('enabled', !settings.notificationSettings.enabled)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${settings.notificationSettings.enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                        >
                            <span className={`block w-4 h-4 rounded-full bg-white transform transition-transform ${settings.notificationSettings.enabled ? 'translate-x-6' : ''}`}></span>
                        </button>
                    </div>
                    {settings.notificationSettings.enabled && (
                        <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700 space-y-3 pt-3">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Notify me for:</p>
                            <div className="flex items-center">
                                <input
                                    type="radio" id="notifyAll" name="notificationTarget" value="all"
                                    checked={settings.notificationSettings.target === 'all'}
                                    onChange={() => handleNotificationSettingsChange('target', 'all')}
                                    className="h-4 w-4 text-indigo-600 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 focus:ring-indigo-500"
                                />
                                <label htmlFor="notifyAll" className="ml-3 block text-sm text-gray-600 dark:text-gray-400">All low stock items</label>
                            </div>
                            <div>
                                <div className="flex items-center">
                                    <input
                                        type="radio" id="notifyMostUsed" name="notificationTarget" value="mostUsed"
                                        checked={settings.notificationSettings.target === 'mostUsed'}
                                        onChange={() => handleNotificationSettingsChange('target', 'mostUsed')}
                                        className="h-4 w-4 text-indigo-600 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 focus:ring-indigo-500"
                                    />
                                    <label htmlFor="notifyMostUsed" className="ml-3 block text-sm text-gray-600 dark:text-gray-400">Only the top N most used items</label>
                                </div>
                                {settings.notificationSettings.target === 'mostUsed' && (
                                    <div className="pl-7 mt-2 flex items-center gap-2">
                                        <label htmlFor="mostUsedCount" className="text-sm text-gray-500 dark:text-gray-400">Number of items (N):</label>
                                        <input
                                            type="number" id="mostUsedCount"
                                            value={settings.notificationSettings.mostUsedCount}
                                            onChange={(e) => handleNotificationSettingsChange('mostUsedCount', parseInt(e.target.value, 10) || 0)}
                                            className="w-24 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md py-1 px-2 text-gray-900 dark:text-white text-sm"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Dashboard Analytics */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="mb-4">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">Dashboard Analytics</h2>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: LOW — persisted to your user profile in Firestore</p>
                </div>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Auto-refresh Analytics</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Automatically update dashboard analytics data</p>
                        </div>
                        <button
                            onClick={() => handleAnalyticsChange('autoRefresh', !settings.analytics?.autoRefresh)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${settings.analytics?.autoRefresh ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                        >
                            <span className={`block w-4 h-4 rounded-full bg-white transform transition-transform ${settings.analytics?.autoRefresh ? 'translate-x-6' : ''}`}></span>
                        </button>
                    </div>
                    {settings.analytics?.autoRefresh && (
                        <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700 pt-3">
                            <div className="flex items-center justify-between">
                                <label htmlFor="refreshInterval" className="text-sm font-medium text-gray-700 dark:text-gray-300">Refresh Interval</label>
                                <select
                                    id="refreshInterval"
                                    value={settings.analytics?.refreshInterval || 30}
                                    onChange={(e) => handleAnalyticsChange('refreshInterval', parseInt(e.target.value))}
                                    className="w-32 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md py-1 px-2 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                >
                                    <option value={10}>10 seconds</option>
                                    <option value={30}>30 seconds</option>
                                    <option value={60}>1 minute</option>
                                    <option value={300}>5 minutes</option>
                                    <option value={600}>10 minutes</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Zoho Sync Settings (only when connected) */}
            {currentOrganization.integrations.zoho.status === 'connected' && (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                    <div className="mb-4">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">Zoho Sync Settings</h2>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: MEDIUM — integration configuration, audited</p>
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label htmlFor="syncFrequency" className="text-sm font-medium text-gray-700 dark:text-gray-300">Sync Frequency</label>
                            <select
                                id="syncFrequency"
                                value={settings.zohoSync?.frequency || 'daily'}
                                onChange={(e) => handleZohoSettingsChange('frequency', e.target.value)}
                                className="w-48 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md py-1 px-2 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            >
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="manual">Manual</option>
                            </select>
                        </div>
                        <div className="flex items-center justify-between">
                            <label htmlFor="defaultCategory" className="text-sm font-medium text-gray-700 dark:text-gray-300">Default Category for New Items</label>
                            <input
                                type="text" id="defaultCategory"
                                value={settings.zohoSync?.defaultCategory || 'Uncategorized'}
                                onChange={(e) => handleZohoSettingsChange('defaultCategory', e.target.value)}
                                className="w-48 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md py-1 px-2 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Stock Take Controls (Admin only) */}
            {currentUser.role === UserRole.Admin && (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                    <div className="mb-1">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">Stock Take Controls</h2>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: HIGH — financial control, notifies all members</p>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Adjustments with a total value impact above this threshold require explicit manager acknowledgement before approval.
                    </p>
                    <div className="flex items-center gap-4">
                        <label htmlFor="riskThreshold" className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                            High-risk threshold (R)
                        </label>
                        <input
                            id="riskThreshold" type="number" min={0} step={500}
                            value={riskThreshold}
                            onChange={(e) => setRiskThreshold(Number(e.target.value))}
                            className="w-36 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md py-1 px-2 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        />
                        <button
                            onClick={handleRiskThresholdSave}
                            disabled={isSavingRiskThreshold}
                            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors"
                        >
                            {isSavingRiskThreshold ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Default: R5,000. Current: R{riskThreshold.toLocaleString()}</p>
                </div>
            )}

            {/* Data & Privacy */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="mb-4">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">Data & Privacy</h2>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: LOW–CRITICAL depending on action — all actions audited</p>
                </div>
                <div className="space-y-3">
                    <div className="flex items-center justify-between py-3">
                        <div>
                            <p className="font-medium text-gray-700 dark:text-gray-300">Download your data</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Export all your inventory and organization data</p>
                        </div>
                        <button onClick={handleDataExport} className="px-4 py-2 text-sm bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-semibold rounded-md hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors">
                            Download
                        </button>
                    </div>

                    {currentUser.role === UserRole.Admin && (
                        <div className="flex items-center justify-between pt-4 pb-3 border-t border-gray-200 dark:border-gray-700 bg-orange-50 dark:bg-orange-900/10 -mx-3 px-3 rounded-lg">
                            <div>
                                <p className="font-semibold text-orange-700 dark:text-orange-400">Clear All Inventory Data</p>
                                <p className="text-sm text-orange-600 dark:text-orange-500 mt-1">Permanently delete all inventory items and activity logs</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This action cannot be undone. Your account remains active.</p>
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Admin only — Severity: CRITICAL</p>
                            </div>
                            <button
                                onClick={() => setShowDeleteAllDataModal(true)}
                                className="px-6 py-2 text-sm bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200 font-bold rounded-md hover:bg-orange-300 dark:hover:bg-orange-700 transition-colors shadow-sm"
                            >
                                Clear All Data
                            </button>
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                        <div>
                            <p className="font-medium text-red-600 dark:text-red-400">Delete Your Account</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Request permanent account deletion (GDPR compliance) — Severity: CRITICAL</p>
                        </div>
                        <button
                            onClick={handleDataDelete}
                            className="px-4 py-2 text-sm bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 font-semibold rounded-md hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
                        >
                            Request Deletion
                        </button>
                    </div>
                </div>
            </div>

            {/* User Management (Admin only) */}
            {currentUser.role === UserRole.Admin && (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                    <div className="flex justify-between items-center mb-4">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-200">User Management</h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Severity: HIGH — all changes are audited and notified</p>
                        </div>
                        <button onClick={() => handleOpenUserModal(null)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>
                            Add User
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                            <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-gray-700">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Name</th>
                                    <th scope="col" className="px-6 py-3">Email</th>
                                    <th scope="col" className="px-6 py-3">Role</th>
                                    <th scope="col" className="px-6 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user) => (
                                    <tr key={user.uid} className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">{user.name}</td>
                                        <td className="px-6 py-4">{user.email}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${user.role === UserRole.Admin ? 'bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200' : 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200'}`}>
                                                {user.role}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            <button onClick={() => handleOpenUserModal(user)} className="font-medium text-indigo-500 hover:underline">Edit</button>
                                            {user.uid !== currentUser.uid && (
                                                <button onClick={() => handleDeleteClick(user)} className="font-medium text-red-500 hover:underline">Delete</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Support & Help */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-200">Support & Help</h2>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                    Need help with setup, billing, or have questions? Contact us directly via WhatsApp for quick support.
                </p>
                <a
                    href="https://wa.me/27736538207?text=Hi,%20I%20need%20help%20with%20StockFlow"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors"
                >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Get Help via WhatsApp
                </a>
            </div>

            {isUserModalOpen && <UserManagementModal user={selectedUser} onClose={() => setIsUserModalOpen(false)} />}

            {userToDelete && (
                <ConfirmationModal
                    isOpen={isConfirmOpen}
                    onClose={() => { setIsConfirmOpen(false); setUserToDelete(null); }}
                    onConfirm={handleConfirmDelete}
                    title="Confirm User Deletion"
                    message={`Are you sure you want to delete the user "${userToDelete.name}"? This action is permanent.`}
                    confirmText="Delete User"
                    isConfirming={isDeleting}
                />
            )}

            <ConfirmationModal
                isOpen={showDeleteAllDataModal}
                onClose={() => setShowDeleteAllDataModal(false)}
                onConfirm={handleDeleteAllDataConfirm}
                title="Clear All Inventory Data"
                message={`This will permanently delete:\n\n${state.inventory.length} inventory items\n${state.activityLogs.length} activity log entries\n\nYour account and organization settings will remain intact.\nThis action cannot be undone.\n\nAre you sure you want to continue?`}
                confirmText="Yes, Delete All Data"
                isConfirming={false}
            />
        </div>
    );
};

export default SettingsView;

import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { activityLogger } from '../services/activityLogger';
import { useAppContext } from '../context/AppContext';

interface UserFormModalProps {
    user: User | null;
    onClose: () => void;
}

const UserManagementModal: React.FC<UserFormModalProps> = ({ user, onClose }) => {
    const { handleAddUser, handleUpdateUser, state } = useAppContext();
    const [formData, setFormData] = useState<Omit<User, 'uid'> | User | null>(null);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [emailError, setEmailError] = useState('');

    useEffect(() => {
        setFormData(user ? { ...user } : {
            name: '',
            email: '',
            role: UserRole.Member, // Default to member
            organizationId: state.currentOrganization.id,
        });
        setPassword('');
        setConfirmPassword('');
        setEmailError('');
    }, [user, state.currentOrganization.id]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => prev ? { ...prev, [name]: value } : null);
        
        // Clear email error when user starts typing
        if (name === 'email') {
            setEmailError('');
        }
    };
    
    const validateEmail = (email: string): boolean => {
        // Check if email already exists in current organization
        const emailExists = state.users.some(u => 
            u.email.toLowerCase() === email.toLowerCase() && 
            (!user || u.uid !== user.uid) // Exclude current user when editing
        );
        
        if (emailExists) {
            setEmailError('This email is already in use in your organization');
            return false;
        }
        
        setEmailError('');
        return true;
    };
    
    const validatePasswords = (): boolean => {
        if (!user) { // Only validate passwords for new users
            if (password.length < 6) {
                return false;
            }
            if (password !== confirmPassword) {
                return false;
            }
        }
        return true;
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData) return;
        
        // Validate email
        if (!validateEmail(formData.email)) {
            return;
        }
        
        // Validate passwords for new users
        if (!user && !validatePasswords()) {
            return;
        }
        
        setIsSaving(true);
        try {
            if ('uid' in formData && formData.uid) { // Check for uid to determine edit mode
                // Log role changes if editing existing user
                const originalUser = user as User;
                if (originalUser.role !== formData.role) {
                    try {
                        await activityLogger.logRoleChange(
                            formData.organizationId,
                            formData.email,
                            originalUser.role,
                            formData.role
                        );
                    } catch (logError) {
                        console.warn('⚠️ Failed to log role change:', logError);
                    }
                }
                await handleUpdateUser(formData as User);
            } else {
                // Create new user with Firebase Auth account
                const { organizationId, ...userData } = formData;
                await handleAddUser(userData as Omit<User, 'uid'|'organizationId'>, password);
            }
            onClose();
        } catch (error) {
            console.error('Error saving user:', error);
        } finally {
            setIsSaving(false);
        }
    };
    
    const isEditMode = user && 'uid' in user;

    if (!formData) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-8 w-full max-w-lg relative shadow-2xl" onClick={e => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">{isEditMode ? 'Edit User' : 'Add New User'}</h2>
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Full Name</label>
                        <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                    </div>
                     <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Email Address</label>
                        <input type="email" name="email" id="email" value={formData.email} onChange={handleChange} required className={`mt-1 block w-full bg-gray-100 dark:bg-gray-700 border rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm ${
                            emailError ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600'
                        }`} />
                        {emailError && (
                            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{emailError}</p>
                        )}
                    </div>
                    {!isEditMode && (
                        <>
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Password</label>
                                <input 
                                    type="password" 
                                    name="password" 
                                    id="password" 
                                    value={password} 
                                    onChange={(e) => setPassword(e.target.value)} 
                                    required 
                                    minLength={6}
                                    className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" 
                                    placeholder="Minimum 6 characters"
                                />
                            </div>
                            <div>
                                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Confirm Password</label>
                                <input 
                                    type="password" 
                                    name="confirmPassword" 
                                    id="confirmPassword" 
                                    value={confirmPassword} 
                                    onChange={(e) => setConfirmPassword(e.target.value)} 
                                    required 
                                    className={`mt-1 block w-full bg-gray-100 dark:bg-gray-700 border rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm ${
                                        password && confirmPassword && password !== confirmPassword ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600'
                                    }`}
                                />
                                {password && confirmPassword && password !== confirmPassword && (
                                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">Passwords do not match</p>
                                )}
                            </div>
                        </>
                    )}
                    <div>
                        <label htmlFor="role" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Role</label>
                        <select name="role" id="role" value={formData.role} onChange={handleChange} className="mt-1 block w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                            {Object.values(UserRole).map(role => <option key={role} value={role}>{role}</option>)}
                        </select>
                    </div>
                    <div className="mt-8 flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white font-semibold rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
                          Cancel
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSaving || emailError !== '' || (!isEditMode && (password.length < 6 || password !== confirmPassword))} 
                            className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:bg-indigo-800 disabled:cursor-wait transition-colors"
                        >
                          {isSaving ? 'Creating Account...' : (isEditMode ? 'Save Changes' : 'Create User')}
                        </button>
                    </div>
                </form>
                 <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
        </div>
    );
};

export default UserManagementModal;
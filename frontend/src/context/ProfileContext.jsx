import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as profileQueries from '../db/queries/profile';

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const [state, setState] = useState({ loading: true, profile: null, error: null });

  const refresh = useCallback(async () => {
    try {
      const profile = await profileQueries.getProfile();
      setState({ loading: false, profile, error: null });
    } catch (e) {
      setState({ loading: false, profile: null, error: e.message });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const completeWelcome = async (displayName) => {
    await profileQueries.createProfile({ displayName });
    await refresh();
  };

  const updateProfile = async (displayName) => {
    await profileQueries.updateProfile({ displayName });
    await refresh();
  };

  return (
    <ProfileContext.Provider value={{ ...state, hasProfile: !!state.profile, completeWelcome, updateProfile, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider');
  return ctx;
}

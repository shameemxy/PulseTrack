import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

function getOrCreateDeviceUUID() {
  const KEY = 'pulsetrack_device_uuid';
  let uuid = localStorage.getItem(KEY);
  if (!uuid) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      uuid = crypto.randomUUID();
    } else {
      uuid = 'device_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }
    localStorage.setItem(KEY, uuid);
  }
  return uuid;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(undefined); // undefined = still loading
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let mounted = true;

    // Check initial Supabase session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      if (error) {
        console.warn("Error getting Supabase session:", error);
      }
      if (session?.user) {
        const user = session.user;
        const isAnon = Boolean(user.is_anonymous || user.app_metadata?.provider === 'anonymous');
        setCurrentUser({
          ...user,
          uid: user.id,
          isAnonymous: isAnon
        });
      } else {
        // No operator session active yet
        setCurrentUser(null);
      }
    }).catch((err) => {
      console.warn("Failed to check Supabase session:", err);
      if (mounted) setCurrentUser(null);
    });

    // Listen for auth state changes (e.g. operator signs in/out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        const user = session.user;
        const isAnon = Boolean(user.is_anonymous || user.app_metadata?.provider === 'anonymous');
        setCurrentUser({
          ...user,
          uid: user.id,
          isAnonymous: isAnon
        });
      } else {
        setCurrentUser(null);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // For victims/safe users: anonymous sign in with persistent device UUID fallback
  const signInAnonymously = async () => {
    setAuthError(null);
    try {
      if (typeof supabase.auth.signInAnonymously === 'function') {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (!error && data?.user) {
          const user = {
            ...data.user,
            uid: data.user.id,
            isAnonymous: true
          };
          setCurrentUser(user);
          return user;
        }
      }
    } catch (e) {
      console.warn("Supabase anonymous auth unavailable, using persistent device UUID:", e);
    }

    // Fallback: persistent device UUID stored in localStorage
    const deviceId = getOrCreateDeviceUUID();
    const fallbackUser = {
      id: deviceId,
      uid: deviceId,
      isAnonymous: true
    };
    setCurrentUser(fallbackUser);
    return fallbackUser;
  };

  // For operators accessing /command-center and /rescue
  const signInWithEmail = async (email, password) => {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (error) {
        setAuthError(error.message);
        return null;
      }
      if (data?.user) {
        const user = {
          ...data.user,
          uid: data.user.id,
          isAnonymous: false
        };
        setCurrentUser(user);
        return user;
      }
      return null;
    } catch (err) {
      setAuthError(err.message);
      return null;
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("Sign out error:", e);
    }
    setCurrentUser(null);
  };

  const value = {
    currentUser,
    isLoading: currentUser === undefined,
    authError,
    signInAnonymously,
    signInWithEmail,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

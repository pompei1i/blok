import { create } from 'zustand';
import type { User } from './types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  register: (username: string, email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  clearError: () => void;
}

// Simulated user database for demo
const mockUsers: { email: string; password: string; user: User }[] = [
  {
    email: 'demo@blok.app',
    password: 'demo123',
    user: {
      id: '1',
      username: 'DemoUser',
      email: 'demo@blok.app',
      displayName: 'Demo User',
      avatarUrl: undefined,
      bio: 'Welcome to Blok!',
      statusMessage: 'Online',
      accentColor: '#c0392b',
      createdAt: new Date().toISOString(),
    }
  }
];

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const foundUser = mockUsers.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    
    if (foundUser) {
      set({ user: foundUser.user, isAuthenticated: true, isLoading: false });
      return { success: true };
    } else {
      set({ isLoading: false, error: 'Invalid email or password' });
      return { success: false, message: 'Invalid email or password' };
    }
  },

  register: async (username, email, password) => {
    set({ isLoading: true, error: null });
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if email already exists
    const existingEmail = mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingEmail) {
      set({ isLoading: false, error: 'Email already registered' });
      return { success: false, message: 'Email already registered' };
    }
    
    // Check if username already exists
    const existingUsername = mockUsers.find(
      u => u.user.username.toLowerCase() === username.toLowerCase()
    );
    if (existingUsername) {
      set({ isLoading: false, error: 'Username already taken' });
      return { success: false, message: 'Username already taken' };
    }
    
    // Create new user
    const newUser: User = {
      id: `u${Date.now()}`,
      username,
      email,
      displayName: username,
      avatarUrl: undefined,
      bio: '',
      statusMessage: 'Online',
      accentColor: '#c0392b',
      createdAt: new Date().toISOString(),
    };
    
    // Add to mock database
    mockUsers.push({ email, password, user: newUser });
    
    set({ user: newUser, isAuthenticated: true, isLoading: false });
    return { success: true };
  },

  logout: () => set({ user: null, isAuthenticated: false, error: null }),
  
  updateUser: (updates) => set((state) => ({
    user: state.user ? { ...state.user, ...updates } : null
  })),
  
  clearError: () => set({ error: null }),
}));

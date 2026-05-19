import { create } from 'zustand';
import type { DMWindowState, DirectMessage } from './types';

interface DMState {
  openDMs: Record<string, DMWindowState>;
  openDM: (userId: string, initialPosition?: { x: number; y: number }) => void;
  closeDM: (userId: string) => void;
  minimizeDM: (userId: string) => void;
  restoreDM: (userId: string) => void;
  updatePosition: (userId: string, position: { x: number; y: number }) => void;
  addMessage: (userId: string, message: DirectMessage) => void;
  clearUnread: (userId: string) => void;
}

export const useDMStore = create<DMState>((set, get) => ({
  openDMs: {},
  
  openDM: (userId, initialPosition) => {
    const currentDMs = get().openDMs;
    if (currentDMs[userId]) {
      // If already open but minimized, restore it
      const dm = currentDMs[userId];
      if (dm.minimized) {
        set({
          openDMs: { ...currentDMs, [userId]: { ...dm, minimized: false } }
        });
      }
      return;
    }
    
    // Calculate position with offset based on number of open DMs
    const offset = Object.keys(currentDMs).length * 30;
    const position = initialPosition || { 
      x: typeof window !== 'undefined' ? window.innerWidth - 380 - offset : 400, 
      y: typeof window !== 'undefined' ? window.innerHeight - 500 - offset : 200 
    };
    
    const newDM: DMWindowState = {
      userId,
      position,
      minimized: false,
      messages: [],
      unreadCount: 0,
    };
    
    set({ openDMs: { ...currentDMs, [userId]: newDM } });
  },
  
  closeDM: (userId) => {
    const { [userId]: _, ...rest } = get().openDMs;
    set({ openDMs: rest });
  },
  
  minimizeDM: (userId) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      set({
        openDMs: { ...currentDMs, [userId]: { ...dm, minimized: true } }
      });
    }
  },
  
  restoreDM: (userId) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      set({
        openDMs: { ...currentDMs, [userId]: { ...dm, minimized: false } }
      });
    }
  },
  
  updatePosition: (userId, position) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      set({
        openDMs: { ...currentDMs, [userId]: { ...dm, position } }
      });
    }
  },
  
  addMessage: (userId, message) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      const isMinimized = dm.minimized;
      set({
        openDMs: { 
          ...currentDMs, 
          [userId]: { 
            ...dm, 
            messages: [...dm.messages, message],
            unreadCount: isMinimized ? dm.unreadCount + 1 : dm.unreadCount
          }
        }
      });
    }
  },
  
  clearUnread: (userId) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      set({
        openDMs: { ...currentDMs, [userId]: { ...dm, unreadCount: 0 } }
      });
    }
  },
}));

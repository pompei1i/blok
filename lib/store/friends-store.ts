import { create } from 'zustand';
import type { Friendship, User, PresenceStatus } from './types';

interface FriendsState {
  friends: (Friendship & { friend: User })[];
  pendingRequests: (Friendship & { friend: User })[];
  outgoingRequests: (Friendship & { friend: User })[];
  presence: Record<string, PresenceStatus>;
  addFriend: (friendship: Friendship & { friend: User }) => void;
  removeFriend: (friendId: string) => void;
  updatePresence: (userId: string, status: PresenceStatus) => void;
  acceptRequest: (friendshipId: string) => void;
  declineRequest: (friendshipId: string) => void;
  sendFriendRequest: (username: string) => { success: boolean; message: string };
  cancelRequest: (friendshipId: string) => void;
}

// Mock friends for demo
const mockFriends: (Friendship & { friend: User })[] = [
  {
    id: '1',
    userId: '1',
    friendId: '2',
    status: 'accepted',
    createdAt: new Date().toISOString(),
    friend: {
      id: '2',
      username: 'CyberNinja',
      email: 'ninja@blok.app',
      displayName: 'Cyber Ninja',
      bio: 'Stealth mode activated',
      createdAt: new Date().toISOString(),
    }
  },
  {
    id: '2',
    userId: '1',
    friendId: '3',
    status: 'accepted',
    createdAt: new Date().toISOString(),
    friend: {
      id: '3',
      username: 'PixelArtist',
      email: 'pixel@blok.app',
      displayName: 'Pixel Artist',
      bio: 'Creating digital dreams',
      createdAt: new Date().toISOString(),
    }
  },
  {
    id: '3',
    userId: '1',
    friendId: '4',
    status: 'accepted',
    createdAt: new Date().toISOString(),
    friend: {
      id: '4',
      username: 'CodeMaster',
      email: 'code@blok.app',
      displayName: 'Code Master',
      bio: 'Full-stack wizard',
      createdAt: new Date().toISOString(),
    }
  },
  {
    id: '4',
    userId: '1',
    friendId: '5',
    status: 'accepted',
    createdAt: new Date().toISOString(),
    friend: {
      id: '5',
      username: 'DataHunter',
      email: 'data@blok.app',
      displayName: 'Data Hunter',
      bio: 'Mining insights from bytes',
      createdAt: new Date().toISOString(),
    }
  },
];

const mockPresence: Record<string, PresenceStatus> = {
  '2': 'online',
  '3': 'afk',
  '4': 'online',
  '5': 'offline',
};

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: mockFriends,
  pendingRequests: [],
  outgoingRequests: [],
  presence: mockPresence,
  addFriend: (friendship) => set((state) => ({
    friends: [...state.friends, friendship]
  })),
  removeFriend: (friendId) => set((state) => ({
    friends: state.friends.filter(f => f.friendId !== friendId)
  })),
  updatePresence: (userId, status) => set((state) => ({
    presence: { ...state.presence, [userId]: status }
  })),
  acceptRequest: (friendshipId) => set((state) => {
    const request = state.pendingRequests.find(r => r.id === friendshipId);
    if (!request) return state;
    return {
      pendingRequests: state.pendingRequests.filter(r => r.id !== friendshipId),
      friends: [...state.friends, { ...request, status: 'accepted' }]
    };
  }),
  declineRequest: (friendshipId) => set((state) => ({
    pendingRequests: state.pendingRequests.filter(r => r.id !== friendshipId)
  })),
  
  sendFriendRequest: (username) => {
    const state = get();
    // Check if already friends
    const alreadyFriend = state.friends.find(
      f => f.friend.username.toLowerCase() === username.toLowerCase()
    );
    if (alreadyFriend) {
      return { success: false, message: 'Already friends with this user' };
    }
    
    // Check if request already sent
    const alreadySent = state.outgoingRequests.find(
      f => f.friend.username.toLowerCase() === username.toLowerCase()
    );
    if (alreadySent) {
      return { success: false, message: 'Friend request already sent' };
    }
    
    // In a real app, this would be an API call
    // For demo, simulate finding a user
    const mockNewFriend: User = {
      id: `u${Date.now()}`,
      username: username,
      email: `${username.toLowerCase()}@blok.app`,
      displayName: username,
      createdAt: new Date().toISOString(),
    };
    
    const newRequest: Friendship & { friend: User } = {
      id: `fr${Date.now()}`,
      userId: '1', // current user
      friendId: mockNewFriend.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      friend: mockNewFriend,
    };
    
    set((state) => ({
      outgoingRequests: [...state.outgoingRequests, newRequest]
    }));
    
    return { success: true, message: `Friend request sent to ${username}` };
  },
  
  cancelRequest: (friendshipId) => set((state) => ({
    outgoingRequests: state.outgoingRequests.filter(r => r.id !== friendshipId)
  })),
}));

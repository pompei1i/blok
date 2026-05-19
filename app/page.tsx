'use client';

import dynamic from 'next/dynamic';
import { useAuthStore } from '@/lib/store/auth-store';
import { AuthScreen } from '@/components/blok/auth-screen';

const AppLayout = dynamic(() => import('@/components/blok/app-layout').then(m => m.AppLayout), {
  ssr: false,
  loading: () => (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0a] text-[#e0e0e0]">
      <div className="text-center">
        <div className="text-2xl font-mono mb-2">BLOK</div>
        <div className="text-sm text-gray-500">Loading...</div>
      </div>
    </div>
  ),
});

export default function Home() {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return <AppLayout />;
}

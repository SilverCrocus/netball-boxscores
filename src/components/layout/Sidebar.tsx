'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/navigation';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col h-full w-[264px] fixed left-0 top-0 bg-slate-900 py-8 z-40 shadow-xl">
      <div className="px-6 mb-8">
        <span className="text-2xl font-black italic tracking-tighter text-white uppercase font-headline">
          NETPULSE
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 py-3 pl-4 border-l-4 transition-all font-headline font-medium text-sm ${
                isActive
                  ? 'text-lime-400 border-lime-400 bg-slate-800/30'
                  : 'text-slate-400 border-transparent hover:bg-slate-800'
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.sidebarLabel ?? item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

import React from 'react';
import {
  LayoutDashboard,
  BookOpenCheck,
  FolderUp,
  CalendarClock,
  BookmarkCheck,
  Settings,
  GraduationCap,
  X,
} from 'lucide-react';
import type { PageId } from '../types/study';

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  activeSourcesCount: number;
  notesCount: number;
}

const NAV_ITEMS: Array<{
  id: PageId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'study-room', label: 'غرفة المذاكرة', icon: BookOpenCheck },
  { id: 'sources', label: 'مصادر المنهج', icon: FolderUp },
  { id: 'scheduler', label: 'الجدول الذكي', icon: CalendarClock },
  { id: 'notes', label: 'مكتبة الملخصات', icon: BookmarkCheck },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onNavigate,
  mobileOpen,
  onCloseMobile,
  activeSourcesCount,
  notesCount,
}) => {
  const handleSelect = (id: PageId) => {
    onNavigate(id);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-slate-900 dark:text-white truncate">
              منصة البكالوريا الذكية
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Bacc-AI · أولى ثانوي
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="إغلاق القائمة الجانبية"
          className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav aria-label="التنقل الرئيسي" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          const metaCount =
            item.id === 'sources' && activeSourcesCount > 0
              ? activeSourcesCount
              : item.id === 'notes' && notesCount > 0
                ? notesCount
                : null;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {metaCount !== null && (
                <span
                  className={`text-xs font-mono tabular-nums ${
                    isActive ? 'text-indigo-100' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {metaCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-300">
          نظام البكالوريا المصرية
        </p>
        <p className="mt-0.5">الصف الأول الثانوي · 9 مواد رسمية</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent right-aligned sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {navContent}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10 shadow-2xl">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
};

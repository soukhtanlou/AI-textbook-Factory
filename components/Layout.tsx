
import React from 'react';
import { AppView, CourseData } from '../types';

interface LayoutProps {
  view: AppView;
  activeCourse: CourseData | null;
  activePageIndex: number;
  onNavigate: (view: AppView, pageIndex?: number) => void;
  onBackToCourses: () => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ 
  view, 
  activeCourse, 
  activePageIndex, 
  onNavigate, 
  onBackToCourses,
  children 
}) => {
  return (
    <div className="h-screen flex flex-col md:flex-row overflow-hidden bg-slate-100">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-slate-900 text-white flex flex-col shrink-0 h-full shadow-xl z-20">
        <div className="p-6 border-b border-slate-700 bg-slate-950">
          <h1 className="text-xl font-bold text-cyan-400">
            کارخانه درس‌ساز
          </h1>
          <div className="text-xs text-slate-400 mt-2">
            پلتفرم هوشمند تولید محتوای درسی
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          
          {/* Main Level: Back to Course List */}
          <button
            onClick={onBackToCourses}
            className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors text-right mb-4 ${
              view === AppView.COURSE_LIST
                ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-700'
                : 'text-slate-400 hover:bg-slate-800 border border-transparent'
            }`}
          >
            <svg className="w-5 h-5 ml-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            لیست درس‌ها
          </button>

          {/* Context Level: Active Course */}
          {activeCourse && (
            <div className="animate-fade-in">
              <div className="text-xs font-bold text-slate-500 px-2 uppercase tracking-wider mb-2">
                درس فعال: {activeCourse.title}
              </div>

              <button
                onClick={() => onNavigate(AppView.DASHBOARD)}
                className={`w-full flex items-center px-4 py-2 rounded-lg transition-colors text-right text-sm mb-4 ${
                  view === AppView.DASHBOARD
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                ⚙️ تنظیمات و تحلیل جامع
              </button>

              <div className="pt-2 pb-2 text-xs font-bold text-slate-500 px-2 uppercase tracking-wider border-t border-slate-700 mt-2">
                صفحات درس
              </div>

              {activeCourse.pages.length === 0 && (
                <div className="text-xs text-slate-600 px-4 py-2 italic">
                  هنوز صفحه‌ای نیست.
                </div>
              )}

              {activeCourse.pages.map((page, index) => {
                 const isActive = view === AppView.EDITOR && activePageIndex === index;
                 return (
                  <button
                    key={page.id}
                    onClick={() => onNavigate(AppView.EDITOR, index)}
                    className={`w-full flex items-center px-4 py-2 rounded-lg transition-colors text-sm text-right ${
                      isActive
                        ? 'bg-cyan-600 text-white shadow-md'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className={`ml-2 w-6 h-6 rounded-full flex items-center justify-center text-xs ${isActive ? 'bg-white text-cyan-600' : 'bg-slate-700'}`}>
                      {index + 1}
                    </span>
                    <span className="truncate">
                       صفحه {index + 1}
                    </span>
                  </button>
                 );
              })}
              
              <button 
                 onClick={() => { document.getElementById('add-page-input')?.click() }}
                 className="w-full mt-4 border border-dashed border-slate-600 text-slate-400 p-2 rounded hover:bg-slate-800 hover:text-white transition-colors text-sm"
              >
                 + افزودن صفحه جدید
              </button>
            </div>
          )}
        </nav>

        {activeCourse && (
          <div className="p-4 border-t border-slate-700 bg-slate-950">
             <button 
               onClick={() => onNavigate(AppView.PLAYER)}
               disabled={!activeCourse.isAnalysisConfirmed || activeCourse.pages.length === 0}
               className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-3 rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all text-sm"
             >
               <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
               </svg>
               پیش‌نمایش پلیر
             </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col bg-slate-100">
        {children}
      </main>
    </div>
  );
};

import React from 'react';
import { Activity, Database, GitBranch, Play, LayoutDashboard, BrainCircuit, Cpu } from 'lucide-react';
import { AppPage, FEATURE_SEQUENCE, PAGE_METADATA } from '../appPages';

interface LayoutProps {
  children: React.ReactNode;
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, activePage, onNavigate }) => {
  // Map icons to pages
  const pageIcons: Record<AppPage, typeof LayoutDashboard> = {
    [AppPage.DASHBOARD]: LayoutDashboard,
    [AppPage.CONTROL_PLANE]: Cpu,
    [AppPage.POLICY_STUDIO]: GitBranch,
    [AppPage.POLICY_FACTORY]: GitBranch,
    [AppPage.SIMULATOR]: Play,
    [AppPage.KNOWLEDGE]: Database,
    [AppPage.MEMORY]: BrainCircuit,
    [AppPage.INITIALIZATION]: Activity,
  };

  // Build navigation items from feature sequence
  // This ensures navigation follows the system lifecycle order
  const navItems = FEATURE_SEQUENCE.map((page) => {
    const metadata = PAGE_METADATA[page];
    const Icon = pageIcons[page];
    
    return {
      id: page,
      label: metadata?.label || page,
      icon: Icon,
      description: metadata?.description,
    };
  });

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="p-6 flex items-center space-x-3 border-b border-slate-700">
          <div className="p-2 bg-indigo-500 rounded-lg">
            <Activity className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">PKG Manager</h1>
            <p className="text-xs text-slate-400">v2.6 Enterprise</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id as AppPage)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors duration-200 ${
                  isActive 
                    ? 'bg-indigo-600 text-white shadow-lg' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                title={item.description}
              >
                <Icon size={20} />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold">
              JS
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">Jane Smith</p>
              <p className="text-xs text-slate-400 truncate">Lead Engineer</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto relative">
        <header className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-800">
              {PAGE_METADATA[activePage]?.label || activePage.replace('-', ' ')}
            </h2>
            <div className="flex items-center space-x-4">
               <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                 System Operational
               </span>
               <span className="text-sm text-gray-500">Env: PROD</span>
            </div>
          </div>
        </header>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
};
import React, { useState } from 'react';

const HomePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'usage' | 'plan' | 'settings' | 'account'>('usage');
  const version = 'v0.6.9';

  return (
    <div className="h-screen flex flex-col bg-sonic-dark text-white font-sans">
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-sonic-gray">
        <div className="flex items-center gap-2">
          <img src="/assets/icon.ico" alt="Sonic Flow Icon" className="w-6 h-6" />
          <h1 className="text-lg font-normal">Sonic Flow</h1>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <nav className="w-44 flex flex-col divide-y divide-gray-700 bg-sonic-darker">
          <button
            className={`px-3 py-2 text-sm text-left ${
              activeTab === 'usage' ? 'bg-sonic-light-orange text-white' : 'text-gray-400'
            } hover:bg-sonic-gray`}
            onClick={() => setActiveTab('usage')}
          >
            Usage
          </button>
          <button
            className={`px-3 py-2 text-sm text-left ${
              activeTab === 'plan' ? 'bg-sonic-light-orange text-white' : 'text-gray-400'
            } hover:bg-sonic-gray`}
            onClick={() => setActiveTab('plan')}
          >
            Plan & Billing
          </button>
          <button
            className={`px-3 py-2 text-sm text-left ${
              activeTab === 'settings' ? 'bg-sonic-light-orange text-white' : 'text-gray-400'
            } hover:bg-sonic-gray`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
          <button
            className={`px-3 py-2 text-sm text-left ${
              activeTab === 'account' ? 'bg-sonic-light-orange text-white' : 'text-gray-400'
            } hover:bg-sonic-gray`}
            onClick={() => setActiveTab('account')}
          >
            Account
          </button>
        </nav>

        <main className="flex-1 p-6 overflow-y-auto bg-sonic-darker">
          {activeTab === 'usage' && (
            <div>
              <h2 className="text-xl mb-2">Usage Dashboard</h2>
              <p>Welcome to your usage dashboard.</p>
              <p>Here you can monitor your activity and performance metrics.</p>
            </div>
          )}
          {activeTab === 'plan' && (
            <div>
              <h2 className="text-xl mb-2">Plan & Billing</h2>
              <p>Review and manage your subscription plan.</p>
              <p>Update billing information and view payment history.</p>
            </div>
          )}
          {activeTab === 'settings' && (
            <div>
              <h2 className="text-xl mb-2">Settings</h2>
              <p>Customize your Sonic Flow experience.</p>
              <p>Configure hotkeys, theme preferences, and microphone settings.</p>
            </div>
          )}
          {activeTab === 'account' && (
            <div>
              <h2 className="text-xl mb-2">Account</h2>
              <p>Manage your account preferences and personal information.</p>
              <p>Update profile settings and security options.</p>
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-sonic-gray p-4 flex justify-between items-center text-sm text-gray-400">
        <span>{version}</span>
        <div className="space-x-2">
          <a href="#" className="hover:underline">
            Support
          </a>
          <span>|</span>
          <a href="#" className="hover:underline">
            About
          </a>
        </div>
      </footer>
    </div>
  );
};

export default HomePage;
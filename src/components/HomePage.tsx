import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const HomePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'usage' | 'plan' | 'settings' | 'account'>('usage');
  const [greeting, setGreeting] = useState<string>('Good morning');
  const version = 'v0.6.9';

  useEffect(() => {
    const getTimeBasedGreeting = () => {
      const hour = new Date().getHours();
      if (hour < 12) return 'Good morning';
      if (hour < 18) return 'Good afternoon';
      return 'Good evening';
    };
    
    setGreeting(getTimeBasedGreeting());
  }, []);

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.1 
      }
    }
  };
  
  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { 
      y: 0, 
      opacity: 1,
      transition: { type: 'spring', stiffness: 300, damping: 24 }
    }
  };

  return (
    <div className="h-screen flex flex-col bg-sonic-darker text-white font-sans">
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-sonic-gray bg-sonic-dark">
        <div className="flex items-center gap-3">
          <motion.div
            whileHover={{ rotate: 360 }}
            transition={{ duration: 0.7 }}
          >
            <img src="/assets/icon.ico" alt="Sonic Flow Icon" className="w-7 h-7" />
          </motion.div>
          <h1 className="text-xl font-medium bg-gradient-to-r from-white to-sonic-light-orange bg-clip-text text-transparent">
            Sonic Flow
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="text-gray-400 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </motion.button>
          
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="w-8 h-8 rounded-full bg-sonic-orange flex items-center justify-center text-sm font-medium cursor-pointer"
          >
            JS
          </motion.div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-52 flex flex-col bg-sonic-dark border-r border-sonic-gray py-4">
          <div className="px-4 mb-6">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Dashboard</p>
          </div>
          
          {[
            { id: 'usage', label: 'Usage', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="7" x2="9" y2="17"></line>
                <path d="M15 7v10"></path>
              </svg>
            )},
            { id: 'plan', label: 'Plan & Billing', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
              </svg>
            )},
            { id: 'settings', label: 'Settings', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            )},
            { id: 'account', label: 'Account', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            )}
          ].map((item) => (
            <motion.button
              key={item.id}
              className={`flex items-center px-4 py-2.5 my-0.5 mx-2 rounded-lg text-sm transition-colors ${
                activeTab === item.id 
                  ? 'bg-sonic-orange text-white' 
                  : 'text-gray-400 hover:bg-sonic-gray hover:text-white'
              }`}
              onClick={() => setActiveTab(item.id as any)}
              whileHover={{ x: 5 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="mr-3">{item.icon}</span>
              {item.label}
            </motion.button>
          ))}
          
          <div className="mt-auto px-4 py-2">
            <div className="bg-gradient-to-r from-sonic-dark to-sonic-gray rounded-lg p-4 border border-sonic-gray">
              <h3 className="text-sm font-medium mb-2">Need help?</h3>
              <p className="text-xs text-gray-400 mb-3">Access our support team and resources</p>
              <motion.button 
                className="w-full text-xs py-1.5 bg-sonic-orange rounded-md hover:bg-sonic-light-orange transition-colors"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Contact Support
              </motion.button>
            </div>
          </div>
        </nav>

        {/* Main content area */}
        <main className="flex-1 p-8 overflow-y-auto bg-sonic-darker">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="max-w-5xl mx-auto"
          >
            <motion.div variants={itemVariants} className="mb-6">
              <h2 className="text-2xl font-medium">{greeting}, User</h2>
              <p className="text-gray-400">Here's what's happening with your account.</p>
            </motion.div>

            {activeTab === 'usage' && (
              <div className="space-y-6">
                <motion.div 
                  variants={itemVariants}
                  className="grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                  {[
                    { title: 'Total Dictations', value: '1,249', change: '+12%', color: 'bg-green-500' },
                    { title: 'Dictation Time', value: '37.2 hrs', change: '+5%', color: 'bg-blue-500' },
                    { title: 'Recognition Rate', value: '98.7%', change: '+1.2%', color: 'bg-sonic-orange' }
                  ].map((stat, index) => (
                    <div 
                      key={index} 
                      className="bg-sonic-dark p-5 rounded-xl border border-sonic-gray hover:border-sonic-gray/80 transition-all"
                    >
                      <h3 className="text-gray-400 text-sm font-medium mb-2">{stat.title}</h3>
                      <div className="flex items-end justify-between">
                        <span className="text-2xl font-semibold">{stat.value}</span>
                        <div className={`text-xs px-1.5 py-0.5 rounded flex items-center ${stat.color} bg-opacity-20 text-${stat.color.replace('bg-', '')}`}>
                          <span className="mr-1">{stat.change}</span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="18 15 12 9 6 15"></polyline>
                          </svg>
                        </div>
                      </div>
                    </div>
                  ))}
                </motion.div>
                
                <motion.div variants={itemVariants} className="bg-sonic-dark p-5 rounded-xl border border-sonic-gray">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-medium">Dictation Activity</h3>
                    <select className="bg-sonic-darker text-sm px-2 py-1 rounded border border-sonic-gray outline-none focus:ring-1 focus:ring-sonic-orange">
                      <option>Last 7 days</option>
                      <option>Last 30 days</option>
                      <option>Last 3 months</option>
                    </select>
                  </div>
                  <div className="h-64 flex items-end justify-between px-2">
                    {[35, 58, 45, 72, 60, 25, 50].map((height, index) => (
                      <motion.div 
                        key={index}
                        initial={{ height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{ duration: 0.5, delay: index * 0.1 }}
                        className="w-12 bg-gradient-to-t from-sonic-orange to-sonic-light-orange rounded-t-md"
                        whileHover={{ scale: 1.05 }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-gray-400">
                    <span>Mon</span>
                    <span>Tue</span>
                    <span>Wed</span>
                    <span>Thu</span>
                    <span>Fri</span>
                    <span>Sat</span>
                    <span>Sun</span>
                  </div>
                </motion.div>
              </div>
            )}
            
            {activeTab === 'plan' && (
              <div className="space-y-6">
                <motion.div 
                  variants={itemVariants}
                  className="bg-sonic-dark p-6 rounded-xl border border-sonic-gray"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h3 className="text-xl font-medium mb-1">Pro Plan</h3>
                      <p className="text-gray-400 text-sm">Your plan renews on Oct 12, 2025</p>
                    </div>
                    <span className="bg-sonic-orange bg-opacity-20 text-sonic-light-orange px-3 py-1 rounded-full text-xs font-medium">
                      Active
                    </span>
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Monthly dictation limit</span>
                      <span className="font-medium">Unlimited</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Custom shortcuts</span>
                      <span className="font-medium">Enabled</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Priority support</span>
                      <span className="font-medium">Enabled</span>
                    </div>
                  </div>
                  <div className="mt-6 pt-6 border-t border-sonic-gray flex flex-wrap gap-3">
                    <motion.button 
                      className="px-4 py-2 bg-sonic-orange rounded-lg text-sm font-medium hover:bg-sonic-light-orange transition-colors"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      Manage Subscription
                    </motion.button>
                    <motion.button 
                      className="px-4 py-2 bg-sonic-gray rounded-lg text-sm font-medium hover:bg-sonic-gray/80 transition-colors"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      Billing History
                    </motion.button>
                  </div>
                </motion.div>
              </div>
            )}
            
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <motion.div variants={itemVariants} className="bg-sonic-dark p-6 rounded-xl border border-sonic-gray">
                  <h3 className="text-lg font-medium mb-4">Application Settings</h3>
                  <div className="space-y-5">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-medium">Launch on startup</label>
                        <div className="w-10 h-5 bg-sonic-gray rounded-full relative">
                          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-sonic-orange rounded-full"></div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400">Automatically start Sonic Flow when you log in.</p>
                    </div>
                    
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-medium">Show notifications</label>
                        <div className="w-10 h-5 bg-sonic-gray rounded-full relative">
                          <div className="absolute left-5 top-0.5 w-4 h-4 bg-sonic-orange rounded-full"></div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400">Display notifications for important events.</p>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium block mb-2">Recognition language</label>
                      <select className="w-full bg-sonic-darker p-2 rounded border border-sonic-gray text-sm outline-none focus:ring-1 focus:ring-sonic-orange">
                        <option>English (US)</option>
                        <option>English (UK)</option>
                        <option>Spanish</option>
                        <option>French</option>
                        <option>German</option>
                      </select>
                    </div>
                  </div>
                </motion.div>
                
                <motion.div variants={itemVariants} className="bg-sonic-dark p-6 rounded-xl border border-sonic-gray">
                  <h3 className="text-lg font-medium mb-4">Microphone Setup</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium block mb-2">Input device</label>
                      <select className="w-full bg-sonic-darker p-2 rounded border border-sonic-gray text-sm outline-none focus:ring-1 focus:ring-sonic-orange">
                        <option>Default Microphone</option>
                        <option>Headset Microphone</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium block mb-2">Input sensitivity</label>
                      <div className="w-full bg-sonic-darker rounded-full h-2">
                        <div className="bg-sonic-orange h-2 rounded-full" style={{ width: '70%' }}></div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
            
            {activeTab === 'account' && (
              <div className="space-y-6">
                <motion.div variants={itemVariants} className="bg-sonic-dark p-6 rounded-xl border border-sonic-gray">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-16 h-16 bg-sonic-orange rounded-full flex items-center justify-center text-xl font-bold">
                      JS
                    </div>
                    <div>
                      <h3 className="text-lg font-medium">John Smith</h3>
                      <p className="text-gray-400">john.smith@example.com</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium block mb-2">Display name</label>
                      <input 
                        type="text" 
                        value="John Smith" 
                        className="w-full bg-sonic-darker p-2 rounded border border-sonic-gray text-sm outline-none focus:ring-1 focus:ring-sonic-orange"
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium block mb-2">Email address</label>
                      <input 
                        type="email" 
                        value="john.smith@example.com" 
                        className="w-full bg-sonic-darker p-2 rounded border border-sonic-gray text-sm outline-none focus:ring-1 focus:ring-sonic-orange"
                      />
                    </div>
                    
                    <div className="pt-4">
                      <motion.button 
                        className="px-4 py-2 bg-sonic-orange rounded-lg text-sm font-medium hover:bg-sonic-light-orange transition-colors"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        Update Profile
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
                
                <motion.div variants={itemVariants} className="bg-sonic-dark p-6 rounded-xl border border-sonic-gray">
                  <h3 className="text-lg font-medium mb-4">Security</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-medium">Two-factor authentication</label>
                        <div className="w-10 h-5 bg-sonic-gray rounded-full relative">
                          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-sonic-orange rounded-full"></div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400">Add an extra layer of security to your account.</p>
                    </div>
                    
                    <button className="text-sm text-sonic-light-orange hover:underline">
                      Change password
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </motion.div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-sonic-gray px-6 py-3 flex justify-between items-center text-sm text-gray-400 bg-sonic-dark">
        <span>{version}</span>
        <div className="space-x-4">
          <a href="#" className="hover:text-sonic-orange hover:underline transition-colors">
            Support
          </a>
          <a href="#" className="hover:text-sonic-orange hover:underline transition-colors">
            Privacy
          </a>
          <a href="#" className="hover:text-sonic-orange hover:underline transition-colors">
            Terms
          </a>
        </div>
      </footer>
    </div>
  );
};

export default HomePage;
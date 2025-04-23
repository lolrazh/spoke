import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const HomePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'home' | 'settings' | 'account'>('home');
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
        staggerChildren: 0.05 // Faster stagger
      }
    }
  };
  
  const itemVariants = {
    hidden: { y: 15, opacity: 0 }, // Less movement
    visible: { 
      y: 0, 
      opacity: 1,
      transition: { type: 'spring', stiffness: 300, damping: 24 }
    }
  };

  return (
    <div className="min-h-screen min-w-screen flex flex-col bg-sonic-darker text-white font-sans text-sm">
      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-52 flex flex-col bg-sonic-dark border-r border-sonic-gray py-4">
          <div className="px-5 mb-6 flex items-center gap-2.5">
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
          
          {[
            { id: 'home', label: 'Home', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
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
              className={`flex items-center px-5 py-2.5 my-0.5 mx-2 rounded-md text-sm transition-colors ${
                activeTab === item.id 
                  ? 'bg-sonic-orange text-white' 
                  : 'text-gray-400 hover:bg-sonic-gray hover:text-white'
              }`}
              onClick={() => setActiveTab(item.id as any)}
              whileHover={{ x: 3 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="mr-3">{item.icon}</span>
              {item.label}
            </motion.button>
          ))}
          
          <div className="mt-auto px-5 py-3">
            <div className="bg-gradient-to-r from-sonic-dark to-sonic-gray rounded-lg p-4 border border-sonic-gray">
              <h3 className="text-xs font-medium mb-1.5">Need help?</h3>
              <p className="text-[11px] text-gray-400 mb-2.5">Access our support team and resources</p>
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
        <main className="flex-1 p-5 overflow-y-auto bg-sonic-darker">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="max-w-5xl"
          >
            <motion.div variants={itemVariants} className="mb-4">
              <h2 className="text-xl font-medium">{greeting}, User</h2>
            </motion.div>

            {activeTab === 'home' && (
              <div>
                <div className="flex flex-col lg:flex-row gap-3">
                  {/* Main Usage Section - Takes up left side */}
                  <div className="space-y-3 lg:w-7/12">
                    <motion.div 
                      variants={itemVariants}
                      className="grid grid-cols-1 md:grid-cols-2 gap-2.5"
                    >
                      {[
                        { title: 'Total Dictations', value: '1,249', change: '+12%', color: 'bg-green-500' },
                        { title: 'Dictation Time', value: '37.2 hrs', change: '+5%', color: 'bg-blue-500' }
                      ].map((stat, index) => (
                        <div 
                          key={index} 
                          className="bg-sonic-dark p-3.5 rounded-lg border border-sonic-gray hover:border-sonic-gray/80 transition-all"
                        >
                          <h3 className="text-gray-400 text-[11px] font-medium mb-1.5">{stat.title}</h3>
                          <div className="flex items-end justify-between">
                            <span className="text-xl font-semibold">{stat.value}</span>
                            <div className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center ${stat.color} bg-opacity-20 text-${stat.color.replace('bg-', '')}`}>
                              <span className="mr-0.5">{stat.change}</span>
                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="18 15 12 9 6 15"></polyline>
                              </svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </motion.div>
                    
                    <motion.div variants={itemVariants} className="bg-sonic-dark p-4 rounded-lg border border-sonic-gray">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-sm font-medium">Time Saved with Dictation</h3>
                        <select className="bg-sonic-darker text-[11px] px-2 py-1 rounded-md border border-sonic-gray outline-none focus:ring-1 focus:ring-sonic-orange">
                          <option>Last 7 days</option>
                          <option>Last 30 days</option>
                          <option>Last 3 months</option>
                        </select>
                      </div>
                      
                      {/* Line chart showing time saved */}
                      <div className="h-48 relative">
                        {/* Chart background grid */}
                        <div className="absolute inset-0 grid grid-cols-7 grid-rows-5">
                          {Array(35).fill(0).map((_, i) => (
                            <div key={i} className="border-r border-t border-sonic-gray/30"></div>
                          ))}
                        </div>
                        
                        {/* Y-axis labels */}
                        <div className="absolute -left-4 top-0 h-full flex flex-col justify-between text-[10px] text-gray-400 py-1.5">
                          <span>5h</span>
                          <span>4h</span>
                          <span>3h</span>
                          <span>2h</span>
                          <span>1h</span>
                          <span>0h</span>
                        </div>
                        
                        {/* Line chart */}
                        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
                          {/* Area under the line */}
                          <defs>
                            <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor="rgba(255, 95, 31, 0.4)" />
                              <stop offset="100%" stopColor="rgba(255, 95, 31, 0)" />
                            </linearGradient>
                          </defs>
                          <path 
                            d="M50,120 L100,80 L150,100 L200,35 L250,60 L300,50 L350,70" 
                            stroke="#FF5F1F" 
                            strokeWidth="2.5" 
                            fill="none" 
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path 
                            d="M50,120 L100,80 L150,100 L200,35 L250,60 L300,50 L350,70 L350,130 L50,130 Z" 
                            fill="url(#gradient)" 
                            opacity="0.5"
                          />
                          
                          {/* Data points */}
                          {[
                            { x: 50, y: 120 },
                            { x: 100, y: 80 },
                            { x: 150, y: 100 },
                            { x: 200, y: 35 },
                            { x: 250, y: 60 },
                            { x: 300, y: 50 },
                            { x: 350, y: 70 }
                          ].map((point, index) => (
                            <circle 
                              key={index}
                              cx={point.x} 
                              cy={point.y} 
                              r="3.5" 
                              fill="#FF5F1F" 
                              stroke="#121212" 
                              strokeWidth="1.5"
                            />
                          ))}
                        </svg>
                        
                        {/* Efficiency indicator */}
                        <div className="absolute top-1.5 right-1.5 bg-sonic-dark/80 p-1.5 rounded-md border border-sonic-gray/50">
                          <div className="text-[10px] text-gray-400">Efficiency</div>
                          <div className="text-base font-bold text-sonic-light-orange">+47%</div>
                        </div>
                      </div>
                      
                      <div className="flex justify-between mt-1.5 text-[10px] text-gray-400 pl-6">
                        <span>Mon</span>
                        <span>Tue</span>
                        <span>Wed</span>
                        <span>Thu</span>
                        <span>Fri</span>
                        <span>Sat</span>
                        <span>Sun</span>
                      </div>
                      
                      <div className="mt-2.5 p-1.5 bg-sonic-darker rounded-md border border-sonic-gray/30">
                        <div className="flex items-center gap-1.5">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                          </svg>
                          <span className="text-[11px] text-gray-400">Based on avg. typing (40 WPM) vs. dictation (150 WPM)</span>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                  
                  {/* Plan Section - Takes up right side */}
                  <motion.div 
                    variants={itemVariants}
                    className="bg-sonic-dark p-4 rounded-lg border border-sonic-gray lg:w-5/12 h-fit"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-base font-medium mb-0.5">Pro Plan</h3>
                        <p className="text-gray-400 text-[11px]">Renews on Oct 12, 2025</p>
                      </div>
                      <span className="bg-sonic-orange bg-opacity-20 text-sonic-light-orange px-2 py-0.5 rounded-full text-[10px] font-medium">
                        Active
                      </span>
                    </div>
                    
                    <div className="space-y-2 mb-3">
                      <div className="bg-sonic-darker p-2.5 rounded-md">
                        <div className="text-[11px] text-gray-400 mb-0.5">Usage</div>
                        <div className="text-sm font-medium">Unlimited</div>
                      </div>
                      <div className="bg-sonic-darker p-2.5 rounded-md">
                        <div className="text-[11px] text-gray-400 mb-0.5">Next Payment</div>
                        <div className="text-sm font-medium">$12.99</div>
                      </div>
                      <div className="bg-sonic-darker p-2.5 rounded-md">
                        <div className="text-[11px] text-gray-400 mb-0.5">Payment Method</div>
                        <div className="text-sm font-medium flex items-center">
                          <span className="mr-1.5">•••• 4242</span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                            <line x1="1" y1="10" x2="23" y2="10"></line>
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div className="pt-2.5 border-t border-sonic-gray">
                      <h4 className="text-[11px] font-medium mb-1.5">Plan Benefits</h4>
                      <ul className="space-y-1 mb-3">
                        <li className="flex items-center text-[11px]">
                          <svg className="text-green-500 mr-1.5" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Unlimited dictation time
                        </li>
                        <li className="flex items-center text-[11px]">
                          <svg className="text-green-500 mr-1.5" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Custom shortcuts
                        </li>
                        <li className="flex items-center text-[11px]">
                          <svg className="text-green-500 mr-1.5" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Priority support
                        </li>
                      </ul>
                    </div>
                    
                    <div className="flex gap-2">
                      <motion.button 
                        className="flex-1 px-2.5 py-1.5 bg-sonic-orange rounded-md text-[11px] font-medium hover:bg-sonic-light-orange transition-colors"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        Manage Plan
                      </motion.button>
                      <motion.button 
                        className="flex-1 px-2.5 py-1.5 bg-sonic-gray rounded-md text-[11px] font-medium hover:bg-sonic-gray/80 transition-colors"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        Billing History
                      </motion.button>
                    </div>
                  </motion.div>
                </div>
              </div>
            )}
            
            {activeTab === 'settings' && (
              <div className="space-y-4">
                <motion.div variants={itemVariants} className="bg-sonic-dark p-5 rounded-lg border border-sonic-gray">
                  <h3 className="text-lg font-medium mb-4">Application Settings</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-sm font-medium">Launch on startup</label>
                        <div className="w-10 h-5 bg-sonic-gray rounded-full relative cursor-pointer">
                          <motion.div 
                            className="absolute left-0.5 top-0.5 w-4 h-4 bg-sonic-orange rounded-full"
                            layout 
                            transition={{ type: "spring", stiffness: 700, damping: 30 }}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-gray-400">Automatically start Sonic Flow when you log in.</p>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Recognition language</label>
                      <select className="w-full bg-sonic-darker p-2.5 rounded-md border border-sonic-gray text-sm outline-none focus:ring-1 focus:ring-sonic-orange">
                        <option>English (US)</option>
                        <option>English (UK)</option>
                        <option>Spanish</option>
                        <option>French</option>
                        <option>German</option>
                      </select>
                    </div>
                  </div>
                </motion.div>
                
                <motion.div variants={itemVariants} className="bg-sonic-dark p-5 rounded-lg border border-sonic-gray">
                  <h3 className="text-lg font-medium mb-4">Microphone Setup</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Input device</label>
                      <select className="w-full bg-sonic-darker p-2.5 rounded-md border border-sonic-gray text-sm outline-none focus:ring-1 focus:ring-sonic-orange">
                        <option>Default Microphone</option>
                        <option>Headset Microphone</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Input sensitivity</label>
                      <input 
                        type="range"
                        min="0" 
                        max="100" 
                        defaultValue="70" 
                        className="w-full h-2 bg-sonic-darker rounded-lg appearance-none cursor-pointer accent-sonic-orange"
                      />
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
            
            {activeTab === 'account' && (
              <div className="space-y-4">
                <motion.div variants={itemVariants} className="bg-sonic-dark p-5 rounded-lg border border-sonic-gray">
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-14 h-14 bg-sonic-orange rounded-full flex items-center justify-center text-lg font-bold">
                      JS
                    </div>
                    <div>
                      <h3 className="text-lg font-medium">John Smith</h3>
                      <p className="text-xs text-gray-400">john.smith@example.com</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Display name</label>
                      <input 
                        type="text" 
                        value="John Smith" 
                        className="w-full bg-sonic-darker p-2.5 rounded-md border border-sonic-gray text-sm outline-none focus:ring-1 focus:ring-sonic-orange"
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Email address</label>
                      <input 
                        type="email" 
                        value="john.smith@example.com" 
                        className="w-full bg-sonic-darker p-2.5 rounded-md border border-sonic-gray text-sm outline-none focus:ring-1 focus:ring-sonic-orange"
                      />
                    </div>
                    
                    <div className="pt-2">
                      <motion.button 
                        className="px-4 py-2 bg-sonic-orange rounded-md text-sm font-medium hover:bg-sonic-light-orange transition-colors"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        Update Profile
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
                
                <motion.div variants={itemVariants} className="bg-sonic-dark p-5 rounded-lg border border-sonic-gray">
                  <h3 className="text-lg font-medium mb-4">Security</h3>
                  <div className="space-y-4">
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
      <footer className="border-t border-sonic-gray px-6 py-3 flex justify-between items-center text-xs text-gray-400 bg-sonic-dark">
        <span>{version}</span>
        <div className="space-x-5">
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
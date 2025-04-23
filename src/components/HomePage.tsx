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
    <div className="h-screen w-screen flex flex-col bg-sonic-darker text-white font-sans">
      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-64 flex flex-col bg-sonic-dark border-r border-sonic-gray py-5">
          <div className="px-6 mb-8 flex items-center gap-3">
            <motion.div
              whileHover={{ rotate: 360 }}
              transition={{ duration: 0.7 }}
            >
              <img src="/assets/icon.ico" alt="Sonic Flow Icon" className="w-8 h-8" />
            </motion.div>
            <h1 className="text-2xl font-medium bg-gradient-to-r from-white to-sonic-light-orange bg-clip-text text-transparent">
              Sonic Flow
            </h1>
          </div>
          
          {[
            { id: 'home', label: 'Home', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            )},
            { id: 'settings', label: 'Settings', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            )},
            { id: 'account', label: 'Account', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            )}
          ].map((item) => (
            <motion.button
              key={item.id}
              className={`flex items-center px-6 py-3 my-1 mx-3 rounded-lg text-base transition-colors ${
                activeTab === item.id 
                  ? 'bg-sonic-orange text-white' 
                  : 'text-gray-400 hover:bg-sonic-gray hover:text-white'
              }`}
              onClick={() => setActiveTab(item.id as any)}
              whileHover={{ x: 5 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="mr-4">{item.icon}</span>
              {item.label}
            </motion.button>
          ))}
          
          <div className="mt-auto px-6 py-4">
            <div className="bg-gradient-to-r from-sonic-dark to-sonic-gray rounded-xl p-5 border border-sonic-gray">
              <h3 className="text-sm font-medium mb-2">Need help?</h3>
              <p className="text-xs text-gray-400 mb-3">Access our support team and resources</p>
              <motion.button 
                className="w-full text-sm py-2 bg-sonic-orange rounded-md hover:bg-sonic-light-orange transition-colors"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Contact Support
              </motion.button>
            </div>
          </div>
        </nav>

        {/* Main content area */}
        <main className="flex-1 p-10 overflow-y-auto bg-sonic-darker">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="max-w-7xl mx-auto"
          >
            <motion.div variants={itemVariants} className="mb-8">
              <h2 className="text-3xl font-medium">{greeting}, User</h2>
            </motion.div>

            {activeTab === 'home' && (
              <div>
                <div className="flex flex-col lg:flex-row gap-8">
                  {/* Main Usage Section - Takes up left side */}
                  <div className="space-y-8 lg:w-8/12">
                    <motion.div 
                      variants={itemVariants}
                      className="grid grid-cols-1 md:grid-cols-3 gap-6"
                    >
                      {[
                        { title: 'Total Dictations', value: '1,249', change: '+12%', color: 'bg-green-500' },
                        { title: 'Dictation Time', value: '37.2 hrs', change: '+5%', color: 'bg-blue-500' },
                        { title: 'Recognition Rate', value: '98.7%', change: '+1.2%', color: 'bg-sonic-orange' }
                      ].map((stat, index) => (
                        <div 
                          key={index} 
                          className="bg-sonic-dark p-6 rounded-xl border border-sonic-gray hover:border-sonic-gray/80 transition-all"
                        >
                          <h3 className="text-gray-400 text-sm font-medium mb-2">{stat.title}</h3>
                          <div className="flex items-end justify-between">
                            <span className="text-3xl font-semibold">{stat.value}</span>
                            <div className={`text-xs px-2 py-1 rounded-full flex items-center ${stat.color} bg-opacity-20 text-${stat.color.replace('bg-', '')}`}>
                              <span className="mr-1">{stat.change}</span>
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="18 15 12 9 6 15"></polyline>
                              </svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </motion.div>
                    
                    <motion.div variants={itemVariants} className="bg-sonic-dark p-6 rounded-xl border border-sonic-gray">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-medium">Time Saved with Dictation</h3>
                        <select className="bg-sonic-darker text-sm px-3 py-2 rounded-lg border border-sonic-gray outline-none focus:ring-1 focus:ring-sonic-orange">
                          <option>Last 7 days</option>
                          <option>Last 30 days</option>
                          <option>Last 3 months</option>
                        </select>
                      </div>
                      
                      {/* Line chart showing time saved */}
                      <div className="h-80 relative">
                        {/* Chart background grid */}
                        <div className="absolute inset-0 grid grid-cols-7 grid-rows-5">
                          {Array(35).fill(0).map((_, i) => (
                            <div key={i} className="border-r border-t border-sonic-gray/30"></div>
                          ))}
                        </div>
                        
                        {/* Y-axis labels */}
                        <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-gray-400 py-2">
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
                              <stop offset="0%" stopColor="rgba(255, 95, 31, 0.5)" />
                              <stop offset="100%" stopColor="rgba(255, 95, 31, 0)" />
                            </linearGradient>
                          </defs>
                          <path 
                            d="M50,180 L100,120 L150,150 L200,50 L250,90 L300,70 L350,110" 
                            stroke="#FF5F1F" 
                            strokeWidth="3" 
                            fill="none" 
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path 
                            d="M50,180 L100,120 L150,150 L200,50 L250,90 L300,70 L350,110 L350,200 L50,200 Z" 
                            fill="url(#gradient)" 
                            opacity="0.5"
                          />
                          
                          {/* Data points */}
                          {[
                            { x: 50, y: 180 },
                            { x: 100, y: 120 },
                            { x: 150, y: 150 },
                            { x: 200, y: 50 },
                            { x: 250, y: 90 },
                            { x: 300, y: 70 },
                            { x: 350, y: 110 }
                          ].map((point, index) => (
                            <circle 
                              key={index}
                              cx={point.x} 
                              cy={point.y} 
                              r="5" 
                              fill="#FF5F1F" 
                              stroke="#121212" 
                              strokeWidth="2"
                            />
                          ))}
                        </svg>
                        
                        {/* Efficiency indicator */}
                        <div className="absolute top-3 right-3 bg-sonic-dark/80 p-3 rounded-lg border border-sonic-gray/50">
                          <div className="text-sm text-gray-400">Efficiency Improved</div>
                          <div className="text-2xl font-bold text-sonic-light-orange">+47%</div>
                        </div>
                      </div>
                      
                      <div className="flex justify-between mt-2 text-xs text-gray-400 pl-6">
                        <span>Mon</span>
                        <span>Tue</span>
                        <span>Wed</span>
                        <span>Thu</span>
                        <span>Fri</span>
                        <span>Sat</span>
                        <span>Sun</span>
                      </div>
                      
                      <div className="mt-4 p-3 bg-sonic-darker rounded-lg border border-sonic-gray/30">
                        <div className="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                          </svg>
                          <span className="text-sm text-gray-400">Based on average typing speed (40 WPM) vs. dictation speed (150 WPM)</span>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                  
                  {/* Plan Section - Takes up right side */}
                  <motion.div 
                    variants={itemVariants}
                    className="bg-sonic-dark p-6 rounded-xl border border-sonic-gray lg:w-4/12 h-fit"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="text-xl font-medium mb-1">Pro Plan</h3>
                        <p className="text-gray-400 text-sm">Renews on Oct 12, 2025</p>
                      </div>
                      <span className="bg-sonic-orange bg-opacity-20 text-sonic-light-orange px-3 py-1 rounded-full text-sm font-medium">
                        Active
                      </span>
                    </div>
                    
                    <div className="space-y-4 mb-6">
                      <div className="bg-sonic-darker p-4 rounded-lg">
                        <div className="text-sm text-gray-400 mb-1">Usage</div>
                        <div className="text-lg font-medium">Unlimited</div>
                      </div>
                      <div className="bg-sonic-darker p-4 rounded-lg">
                        <div className="text-sm text-gray-400 mb-1">Next Payment</div>
                        <div className="text-lg font-medium">$12.99</div>
                      </div>
                      <div className="bg-sonic-darker p-4 rounded-lg">
                        <div className="text-sm text-gray-400 mb-1">Payment Method</div>
                        <div className="text-lg font-medium flex items-center">
                          <span className="mr-2">•••• 4242</span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                            <line x1="1" y1="10" x2="23" y2="10"></line>
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t border-sonic-gray">
                      <h4 className="text-sm font-medium mb-3">Plan Benefits</h4>
                      <ul className="space-y-2 mb-6">
                        <li className="flex items-center text-sm">
                          <svg className="text-green-500 mr-2" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Unlimited dictation time
                        </li>
                        <li className="flex items-center text-sm">
                          <svg className="text-green-500 mr-2" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Custom shortcuts
                        </li>
                        <li className="flex items-center text-sm">
                          <svg className="text-green-500 mr-2" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Priority support
                        </li>
                      </ul>
                    </div>
                    
                    <div className="flex gap-3">
                      <motion.button 
                        className="flex-1 px-4 py-2 bg-sonic-orange rounded-lg text-sm font-medium hover:bg-sonic-light-orange transition-colors"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        Manage Plan
                      </motion.button>
                      <motion.button 
                        className="flex-1 px-4 py-2 bg-sonic-gray rounded-lg text-sm font-medium hover:bg-sonic-gray/80 transition-colors"
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
              <div className="space-y-8">
                <motion.div variants={itemVariants} className="bg-sonic-dark p-8 rounded-xl border border-sonic-gray">
                  <h3 className="text-xl font-medium mb-6">Application Settings</h3>
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-base font-medium">Launch on startup</label>
                        <div className="w-12 h-6 bg-sonic-gray rounded-full relative">
                          <div className="absolute left-1 top-1 w-4 h-4 bg-sonic-orange rounded-full"></div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-400">Automatically start Sonic Flow when you log in.</p>
                    </div>
                    
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-base font-medium">Show notifications</label>
                        <div className="w-12 h-6 bg-sonic-gray rounded-full relative">
                          <div className="absolute left-7 top-1 w-4 h-4 bg-sonic-orange rounded-full"></div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-400">Display notifications for important events.</p>
                    </div>
                    
                    <div>
                      <label className="text-base font-medium block mb-3">Recognition language</label>
                      <select className="w-full bg-sonic-darker p-3 rounded-lg border border-sonic-gray text-base outline-none focus:ring-1 focus:ring-sonic-orange">
                        <option>English (US)</option>
                        <option>English (UK)</option>
                        <option>Spanish</option>
                        <option>French</option>
                        <option>German</option>
                      </select>
                    </div>
                  </div>
                </motion.div>
                
                <motion.div variants={itemVariants} className="bg-sonic-dark p-8 rounded-xl border border-sonic-gray">
                  <h3 className="text-xl font-medium mb-6">Microphone Setup</h3>
                  <div className="space-y-6">
                    <div>
                      <label className="text-base font-medium block mb-3">Input device</label>
                      <select className="w-full bg-sonic-darker p-3 rounded-lg border border-sonic-gray text-base outline-none focus:ring-1 focus:ring-sonic-orange">
                        <option>Default Microphone</option>
                        <option>Headset Microphone</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="text-base font-medium block mb-3">Input sensitivity</label>
                      <div className="w-full bg-sonic-darker rounded-full h-2.5">
                        <div className="bg-sonic-orange h-2.5 rounded-full" style={{ width: '70%' }}></div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
            
            {activeTab === 'account' && (
              <div className="space-y-8">
                <motion.div variants={itemVariants} className="bg-sonic-dark p-8 rounded-xl border border-sonic-gray">
                  <div className="flex items-center gap-6 mb-8">
                    <div className="w-20 h-20 bg-sonic-orange rounded-full flex items-center justify-center text-2xl font-bold">
                      JS
                    </div>
                    <div>
                      <h3 className="text-xl font-medium">John Smith</h3>
                      <p className="text-gray-400">john.smith@example.com</p>
                    </div>
                  </div>
                  
                  <div className="space-y-6">
                    <div>
                      <label className="text-base font-medium block mb-3">Display name</label>
                      <input 
                        type="text" 
                        value="John Smith" 
                        className="w-full bg-sonic-darker p-3 rounded-lg border border-sonic-gray text-base outline-none focus:ring-1 focus:ring-sonic-orange"
                      />
                    </div>
                    
                    <div>
                      <label className="text-base font-medium block mb-3">Email address</label>
                      <input 
                        type="email" 
                        value="john.smith@example.com" 
                        className="w-full bg-sonic-darker p-3 rounded-lg border border-sonic-gray text-base outline-none focus:ring-1 focus:ring-sonic-orange"
                      />
                    </div>
                    
                    <div className="pt-4">
                      <motion.button 
                        className="px-5 py-2.5 bg-sonic-orange rounded-lg text-base font-medium hover:bg-sonic-light-orange transition-colors"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        Update Profile
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
                
                <motion.div variants={itemVariants} className="bg-sonic-dark p-8 rounded-xl border border-sonic-gray">
                  <h3 className="text-xl font-medium mb-6">Security</h3>
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-base font-medium">Two-factor authentication</label>
                        <div className="w-12 h-6 bg-sonic-gray rounded-full relative">
                          <div className="absolute left-1 top-1 w-4 h-4 bg-sonic-orange rounded-full"></div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-400">Add an extra layer of security to your account.</p>
                    </div>
                    
                    <button className="text-base text-sonic-light-orange hover:underline">
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
      <footer className="border-t border-sonic-gray px-8 py-4 flex justify-between items-center text-sm text-gray-400 bg-sonic-dark">
        <span>{version}</span>
        <div className="space-x-6">
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
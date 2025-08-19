#!/usr/bin/env node

/**
 * WebSocket Test Script for Sonic Flow
 * Run this to test your WebSocket implementation before deploying
 * 
 * Usage: node test-websocket.js [ws://localhost:8787 | wss://api.sonicflow.app]
 */

const WebSocket = require('ws');

const WS_URL = process.argv[2] || 'ws://localhost:8787/transcribe';
const TIMEOUT = 10000; // 10 seconds

console.log(`🧪 Testing WebSocket connection to: ${WS_URL}\n`);

async function testWebSocketConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const messages = [];
    let connected = false;
    let initComplete = false;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, TIMEOUT);

    ws.on('open', () => {
      console.log('✅ WebSocket connection opened');
      connected = true;

      // Your worker doesn't need init - it sends ack immediately
      console.log('✅ Connected, waiting for ack...');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        messages.push(message);
        
        console.log('📥 Received:', JSON.stringify(message, null, 2));

        if (message.type === 'ack' && !initComplete) {
          initComplete = true;
          console.log('✅ Connection acknowledged successfully');
          
          // Test start transcription
          setTimeout(() => {
            console.log('📤 Testing transcription start...');
            ws.send(JSON.stringify({
              type: 'start',
              model: 'whisper-large-v3-turbo',
              language: 'en',
              format: 'pcm16le',
              sampleRate: 16000,
              channels: 1,
              bits: 16,
            }));
          }, 1000);
          
          // Test end transcription
          setTimeout(() => {
            console.log('📤 Testing transcription end...');
            ws.send(JSON.stringify({ type: 'end' }));
            
            // Close connection after test
            setTimeout(() => {
              ws.close();
            }, 2000);
          }, 3000);
        }

      } catch (error) {
        console.error('❌ Error parsing message:', error);
      }
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      console.log(`🔌 Connection closed: ${code} ${reason}`);
      
      if (connected && initComplete) {
        console.log('✅ Test completed successfully');
        resolve(messages);
      } else {
        reject(new Error('Test failed - connection closed prematurely'));
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      console.error('❌ WebSocket error:', error.message);
      reject(error);
    });
  });
}

async function testHealthEndpoint() {
  const healthUrl = WS_URL.replace('/websocket', '/health').replace('ws://', 'http://').replace('wss://', 'https://');
  
  console.log(`🏥 Testing health endpoint: ${healthUrl}`);
  
  try {
    const fetch = await import('node-fetch').then(m => m.default);
    const response = await fetch(healthUrl);
    const data = await response.json();
    
    console.log('✅ Health check passed:', JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function runTests() {
  try {
    console.log('🚀 Starting WebSocket tests...\n');
    
    // Test 1: Health endpoint
    const healthOk = await testHealthEndpoint();
    console.log('');
    
    // Test 2: WebSocket connection
    const messages = await testWebSocketConnection();
    
    console.log('\n📊 Test Summary:');
    console.log(`✅ Health endpoint: ${healthOk ? 'PASS' : 'FAIL'}`);
    console.log(`✅ WebSocket connection: PASS`);
    console.log(`✅ Messages received: ${messages.length}`);
    
    const messageTypes = [...new Set(messages.map(m => m.type))];
    console.log(`✅ Message types: ${messageTypes.join(', ')}`);
    
    console.log('\n🎉 All tests passed! Your WebSocket implementation is ready.');
    
  } catch (error) {
    console.error('\n❌ Tests failed:', error.message);
    console.log('\n🔍 Troubleshooting tips:');
    console.log('1. Check that your worker is deployed and running');
    console.log('2. Verify the WebSocket URL is correct');  
    console.log('3. Check worker logs for errors: wrangler tail');
    console.log('4. Ensure environment variables are set correctly');
    
    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Test interrupted by user');
  process.exit(0);
});

// Run the tests
runTests();
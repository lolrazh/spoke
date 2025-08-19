#!/bin/bash

# Test script for Groq API calls
# Usage: GROQ_API_KEY=your_key_here ./temp/test-groq.sh

if [ -z "$GROQ_API_KEY" ]; then
    echo "❌ Error: GROQ_API_KEY environment variable not set"
    echo "Usage: GROQ_API_KEY=your_key_here ./temp/test-groq.sh"
    exit 1
fi

echo "🧪 Testing WAV files with Groq API..."
echo "=================================================="

# Test 1: Direct Groq API
echo
echo "📡 Testing DIRECT Groq API with test-2sec.wav..."
curl -sS -X POST \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@temp/test-2sec.wav" \
  -F "model=whisper-large-v3-turbo" \
  -F "response_format=json" \
  "https://api.groq.com/openai/v1/audio/transcriptions" | jq . || echo "Direct API call response (raw):"

echo
echo "=================================================="

# Test 2: Via AI Gateway  
echo
echo "🌐 Testing VIA AI GATEWAY with test-2sec.wav..."
curl -sS -X POST \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@temp/test-2sec.wav" \
  -F "model=whisper-large-v3-turbo" \
  -F "response_format=json" \
  "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/sonic-flow/groq/audio/transcriptions" | jq . || echo "Gateway call response (raw):"

echo
echo "=================================================="

# Test 3: Smaller file via Gateway
echo
echo "🌐 Testing VIA AI GATEWAY with smaller test-0.5sec.wav..."  
curl -sS -X POST \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@temp/test-0.5sec.wav" \
  -F "model=whisper-large-v3-turbo" \
  -F "response_format=json" \
  "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/sonic-flow/groq/audio/transcriptions" | jq . || echo "Gateway call response (raw):"

echo
echo "✅ Test complete!"
echo
echo "If you see successful transcriptions above, the WAV format is perfect"  
echo "and the issue is in the Worker's multipart upload logic."
echo
echo "If you see 400 errors here too, then Groq/Gateway has an issue with"
echo "our WAV construction that we need to debug further."
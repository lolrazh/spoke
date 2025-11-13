#!/bin/bash
# Quick script to diagnose STT/LLM failures from worker logs
# Usage: npm run dev:ws 2>&1 | ./debug-logs.sh

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

while IFS= read -r line; do
  # Check if line is JSON
  if echo "$line" | jq -e . >/dev/null 2>&1; then
    event=$(echo "$line" | jq -r '.event // empty')

    case "$event" in
      "stt.request")
        provider=$(echo "$line" | jq -r '.provider')
        timeout=$(echo "$line" | jq -r '.timeoutMs')
        audioKB=$(echo "$line" | jq -r '.audioSizeKB')
        echo -e "${BLUE}▶ STT START${NC} [${provider}] timeout=${timeout}ms audio=${audioKB}KB"
        ;;

      "stt.complete")
        duration=$(echo "$line" | jq -r '.durationMs')
        textLen=$(echo "$line" | jq -r '.textLength')
        echo -e "${GREEN}✓ STT DONE${NC} in ${duration}ms (${textLen} chars)"
        ;;

      "stt.abort")
        reason=$(echo "$line" | jq -r '.reason')
        elapsed=$(echo "$line" | jq -r '.elapsedMs')
        echo -e "${RED}✗ STT ABORTED${NC} reason=${reason} after ${elapsed}ms"
        ;;

      "llm.request"|"edit.request")
        provider=$(echo "$line" | jq -r '.provider')
        model=$(echo "$line" | jq -r '.model')
        timeout=$(echo "$line" | jq -r '.timeoutMs')
        echo -e "${MAGENTA}▶ LLM START${NC} [${provider}/${model}] timeout=${timeout}ms"
        ;;

      "llm.complete"|"edit.complete")
        duration=$(echo "$line" | jq -r '.durationMs')
        textLen=$(echo "$line" | jq -r '.textLength')
        success=$(echo "$line" | jq -r '.success')
        if [ "$success" = "true" ]; then
          echo -e "${GREEN}✓ LLM DONE${NC} in ${duration}ms (${textLen} chars)"
        else
          echo -e "${YELLOW}⚠ LLM DONE${NC} in ${duration}ms (${textLen} chars) - empty response"
        fi
        ;;

      "llm.abort"|"edit.abort")
        reason=$(echo "$line" | jq -r '.reason')
        elapsed=$(echo "$line" | jq -r '.elapsedMs')
        echo -e "${RED}✗ LLM ABORTED${NC} reason=${reason} after ${elapsed}ms"
        ;;

      "pipeline.error")
        stage=$(echo "$line" | jq -r '.stage')
        errorName=$(echo "$line" | jq -r '.errorName')
        sttCompleted=$(echo "$line" | jq -r '.sttCompleted')
        echo ""
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${RED}✗✗✗ PIPELINE FAILED ✗✗✗${NC}"
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        if [ "$stage" = "stt" ]; then
          echo -e "${RED}PROBLEM: GROQ (STT)${NC}"
          echo -e "  Error: ${errorName}"
          echo -e "  → Groq transcription failed or timed out"
        else
          echo -e "${RED}PROBLEM: ${stage^^} (LLM)${NC}"
          echo -e "  Error: ${errorName}"
          echo -e "  STT completed: ${sttCompleted}"
          echo -e "  → Baseten/LLM processing failed or timed out"
        fi
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        ;;

      *)
        # Pass through non-pipeline logs
        echo "$line"
        ;;
    esac
  else
    # Pass through non-JSON lines
    echo "$line"
  fi
done

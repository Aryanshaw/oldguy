#!/usr/bin/env bash
# THROWAWAY: append the hook's stdin JSON and a few env vars to a log, once per invocation
OUT="${YAP_SPIKE_LOG:-/tmp/yap-hook-spike.log}"
{ echo "=== $1 $(date -u +%T)"; cat; echo; echo "ROOT=${CLAUDE_PLUGIN_ROOT:-unset}"; echo "DATA=${CLAUDE_PLUGIN_DATA:-unset}"; echo "PROJECT=${CLAUDE_PROJECT_DIR:-unset}"; } >> "$OUT"

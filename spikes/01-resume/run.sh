#!/usr/bin/env bash
# THROWAWAY spike 1: can a closed session be resumed headlessly, and is a fork needed?
set -u
D1=$(mktemp -d /tmp/yap-spike1-a.XXXX); D2=$(mktemp -d /tmp/yap-spike1-b.XXXX)
echo "D1=$D1 D2=$D2"
cd "$D1"
# 1. start a session and read its id
OUT=$(claude -p "Remember the code word KIWI. Reply with just OK." --output-format json 2>&1)
echo "$OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('keys:',sorted(d.keys())); print('session_id:',d.get('session_id')); print('cost_usd:',d.get('total_cost_usd')); print('result:',d.get('result'))" | tee /tmp/yap-spike1-start.txt
ID=$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['session_id'])")
echo "$ID" > /tmp/yap-spike1-id.txt
# 2. resume the same session
echo "--- resume (same folder)"
claude -p --resume "$ID" "What was the code word? One word." --output-format json 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print('session_id:',d.get('session_id')); print('result:',d.get('result')); print('cost_usd:',d.get('total_cost_usd'))"

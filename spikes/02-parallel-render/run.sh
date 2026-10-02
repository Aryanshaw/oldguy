#!/usr/bin/env bash
# THROWAWAY spike 2. usage: run.sh seq|par|single [workers]
# Renders the three one-chapter projects p1..p3 at --quality draft and samples total memory
# (RSS of every node/chrome/ffmpeg process) once a second. Prints wall time, peak MB, exit codes.
. "$(dirname "$0")/../env.sh"; cd "$(dirname "$0")"; mkdir -p out
MODE=${1:-seq}; W=${2:-auto}
peak=0; : > out/mem.txt
sampler(){ while :; do ps -axo rss=,comm= | awk '/node|chrome|headless|ffmpeg|Chrome/ {s+=$1} END {print int(s/1024)}' >> out/mem.txt; sleep 1; done; }
sampler & SP=$!
START=$(date +%s)
render(){ ( cd "$1" && npx hyperframes render . -q draft -w "$W" -o "../out/$1-$MODE.mp4" > "../out/$1-$MODE.log" 2>&1; echo "$1 exit=$?" >> ../out/exit-$MODE.txt ); }
: > out/exit-$MODE.txt
case $MODE in
  single) render p1;;
  seq) for p in p1 p2 p3; do render $p; done;;
  par) PIDS=""; for p in p1 p2 p3; do render $p & PIDS="$PIDS $!"; done; wait $PIDS;;
esac
END=$(date +%s); kill $SP 2>/dev/null
echo "mode=$MODE workers=$W wall=$((END-START))s peak_mb=$(sort -n out/mem.txt | tail -1) base_mb=$(head -1 out/mem.txt)"
cat out/exit-$MODE.txt

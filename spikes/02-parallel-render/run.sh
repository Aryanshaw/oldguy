#!/usr/bin/env bash
# THROWAWAY spike 2. usage: run.sh seq|par|single [workers]
# Renders the one-chapter projects p1..p3 at --quality draft, samples total memory (RSS of every
# node/chrome/ffmpeg process) once a second, and APPENDS one line to results.tsv plus keeps the
# per-run logs under results/<mode>-w<workers>-<time>/ (mp4 files go to out/ and are not kept).
. "$(dirname "$0")/../env.sh"; cd "$(dirname "$0")"; mkdir -p out results
MODE=${1:-seq}; W=${2:-auto}; TAG="$MODE-w$W-$(date +%H%M%S)"; R="results/$TAG"; mkdir -p "$R"
: > "$R/mem.txt"; : > "$R/exit.txt"
sampler(){ while :; do ps -axo rss=,comm= | awk '/node|chrome|headless|ffmpeg|Chrome/ {s+=$1} END {print int(s/1024)}' >> "$R/mem.txt"; sleep 1; done; }
sampler & SP=$!
START=$(date +%s)
render(){ ( cd "$1" && npx hyperframes render . -q draft -w "$W" -o "../out/$1-$TAG.mp4" > "../$R/$1.log" 2>&1; echo "$1 exit=$?" >> "../$R/exit.txt" ); }
case $MODE in
  single) render p1;;
  seq) for p in p1 p2 p3; do render $p; done;;
  par) PIDS=""; for p in p1 p2 p3; do render $p & PIDS="$PIDS $!"; done; wait $PIDS;;   # wait only for the renders, not the sampler
esac
END=$(date +%s); kill $SP 2>/dev/null; wait $SP 2>/dev/null
PEAK=$(sort -n "$R/mem.txt" | tail -1); BASE=$(head -1 "$R/mem.txt"); FAILS=$(grep -vc "exit=0" "$R/exit.txt")
printf "%s\t%s\t%s\twall_s=%s\tpeak_mb=%s\tbase_mb=%s\tfailures=%s\n" "$TAG" "$MODE" "$W" "$((END-START))" "$PEAK" "$BASE" "$FAILS" | tee -a results.tsv
rm -f out/*"$TAG".mp4

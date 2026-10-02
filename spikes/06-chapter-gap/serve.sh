#!/usr/bin/env bash
# THROWAWAY: serve this folder on 127.0.0.1:8791 with HTTP range support (python's http.server has none)
cd "$(dirname "$0")" && exec npx --yes http-server . -p 8791 -a 127.0.0.1 -c-1 --silent

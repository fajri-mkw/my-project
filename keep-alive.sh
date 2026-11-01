#!/bin/bash
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
export NODE_OPTIONS="--max-old-space-size=2048"
cd /home/z/my-project

while true; do
    echo "[$(date)] Starting dev server..."
    bun run dev
    EXIT_CODE=$?
    echo "[$(date)] Server exited with code $EXIT_CODE, restarting in 2s..."
    sleep 2
done

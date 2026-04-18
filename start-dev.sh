#!/bin/bash
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
cd /home/z/my-project
exec bun run dev

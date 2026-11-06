#!/bin/sh
set -eu

if [ -z "${JWT_SECRET:-}" ]; then
    echo "FATAL: JWT_SECRET is empty or unset; set JWT_SECRET in .env before starting." >&2
    exit 1
fi

exec "$@"

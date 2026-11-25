#!/bin/bash
# Smoke-test that the production bundle builds. Output goes to a throwaway
# directory so the real dist/ is untouched.

OUT_DIR=$(mktemp -d)
trap 'rm -rf "$OUT_DIR"' EXIT

OUTPUT=$(npx vite build --minify false --logLevel error --outDir "$OUT_DIR" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "$OUTPUT"
fi

exit $EXIT_CODE

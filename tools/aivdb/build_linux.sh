#!/usr/bin/env sh
set -eu

CC="${CC:-cc}"
CFLAGS="-O3 -std=c11 -Wall -Wextra -fPIC ${AIVDB_EXTRA_CFLAGS:-}"
LDFLAGS="${AIVDB_EXTRA_LDFLAGS:-}"
ARCH="$(uname -m)"
OUT_DIR="${AIVDB_OUT_DIR:-dist/linux-$ARCH}"
mkdir -p "$OUT_DIR"

echo "Building AIVDB for Linux/Debian/Raspberry Pi with $CC"

$CC $CFLAGS -shared -o "$OUT_DIR/libaivdb_kernel.so" aivdb_kernel.c -lm $LDFLAGS

echo "Built:"
ls -lh "$OUT_DIR/libaivdb_kernel.so"

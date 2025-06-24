set -e
cd "$(dirname "$0")"
clang -Os -framework ApplicationServices fn-tap.c -o ../public/assets/fn-tap
strip -x ../public/assets/fn-tap 
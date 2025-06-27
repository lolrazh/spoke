set -e
cd "$(dirname "$0")"
clang -Os -framework ApplicationServices fn-tap.c -o ../public/assets/fn-tap
strip -x ../public/assets/fn-tap

clang -Os -framework ApplicationServices paste-helper.c -o ../public/assets/paste-helper
strip -x ../public/assets/paste-helper 
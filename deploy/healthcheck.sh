#!/bin/sh
set -eu

origin=http://127.0.0.1:8080
build=$(wget -qO- "$origin/build.json")
printf '%s' "$build" | grep -q '"app": "audiobrain"'
printf '%s' "$build" | grep -q '"commit": "'"$AUDIOBRAIN_COMMIT"'"'

index=$(wget -qO- "$origin/audiobrain/")
asset=$(printf '%s' "$index" | sed -n 's/.*src="\([^\"]*\.js\)".*/\1/p' | head -n 1)
case "$asset" in
  /audiobrain/assets/*.js) ;;
  *) exit 1 ;;
esac
wget -qO /dev/null "$origin$asset"
wget -qO /dev/null "$origin/audiobrain/storybook/index.html"

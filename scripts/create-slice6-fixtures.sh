#!/usr/bin/env bash

set -euo pipefail

destination=${1:-/mnt/c/src/coax-win/artifacts/m0/fixtures}

for command in ffmpeg ffprobe mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command (run inside 'nix develop')." >&2
    exit 1
  fi
done

mkdir -p "$destination"
temporary_directory=$(mktemp -d)
trap 'rm -rf -- "$temporary_directory"' EXIT

encode_progressive() {
  local size=$1
  local duration=$2
  local pixel_format=$3
  local output=$4
  ffmpeg -hide_banner -loglevel warning -y \
    -f lavfi -i "testsrc2=size=${size}:rate=50" \
    -f lavfi -i 'sine=frequency=1000:sample_rate=48000' \
    -t "$duration" \
    -c:v libx264 -preset ultrafast -tune zerolatency -crf 20 \
    -pix_fmt "$pixel_format" -g 100 -keyint_min 100 -sc_threshold 0 \
    -c:a aac -b:a 128k -shortest \
    "$output"
}

clean_temporary="$temporary_directory/clean-720p50.mkv"
encode_progressive 1280x720 640 yuv420p "$clean_temporary"
mv -f -- "$clean_temporary" "$destination/clean-720p50.mkv"

fallback_temporary="$temporary_directory/hwdec-fallback-720p50.mkv"
encode_progressive 1280x720 30 yuv444p "$fallback_temporary"
mv -f -- "$fallback_temporary" "$destination/hwdec-fallback-720p50.mkv"

for definition in '720a:1280x720' '1080:1920x1080' '720b:1280x720'; do
  name=${definition%%:*}
  size=${definition#*:}
  ffmpeg -hide_banner -loglevel warning -y \
    -f lavfi -i "testsrc2=size=${size}:rate=50" \
    -t 5 \
    -an -c:v libx264 -preset ultrafast -tune zerolatency -crf 20 \
    -pix_fmt yuv420p -g 50 -keyint_min 50 -sc_threshold 0 \
    -f mpegts "$temporary_directory/$name.mpegts"
done
ffmpeg -hide_banner -loglevel warning -y \
  -i "concat:$temporary_directory/720a.mpegts|$temporary_directory/1080.mpegts|$temporary_directory/720b.mpegts" \
  -map 0:v:0 -c copy -f mpegts "$temporary_directory/resolution-change-50.mpegts"
mv -f -- "$temporary_directory/resolution-change-50.mpegts" \
  "$destination/resolution-change-50.mpegts"

for fixture in \
  clean-720p50.mkv \
  hwdec-fallback-720p50.mkv \
  resolution-change-50.mpegts; do
  ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate \
    -of compact=p=0:nk=1 "$destination/$fixture"
done

echo "Slice 6 fixtures created under $destination"

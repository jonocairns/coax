#!/usr/bin/env bash

set -euo pipefail

destination=${1:-/mnt/c/src/coax-win/artifacts/m0/fixtures}

for command in awk ffmpeg ffprobe mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command (run inside 'nix develop')." >&2
    exit 1
  fi
done

mkdir -p "$destination"
temporary_directory=$(mktemp -d "$destination/.slice7-build.XXXXXX")
trap 'rm -rf -- "$temporary_directory"' EXIT

encode_progressive() {
  local size=$1
  local rate=$2
  local duration=$3
  local crf=$4
  local output=$5
  ffmpeg -hide_banner -loglevel warning -y \
    -f lavfi -i "testsrc2=size=${size}:rate=${rate}" \
    -f lavfi -i 'sine=frequency=880:sample_rate=48000' \
    -t "$duration" \
    -c:v libx264 -preset ultrafast -tune zerolatency -crf "$crf" \
    -pix_fmt yuv420p -g 100 -keyint_min 100 -sc_threshold 0 \
    -c:a aac -b:a 96k -shortest \
    "$output"
}

encode_interlaced() {
  local size=$1
  local content_order=$2
  local metadata_order=$3
  local duration=$4
  local output=$5
  local aspect_filter=''
  if [[ $size == 720x576 ]]; then
    aspect_filter=',setsar=16/15'
  fi
  ffmpeg -hide_banner -loglevel warning -y \
    -f lavfi -i "testsrc2=size=${size}:rate=50" \
    -f lavfi -i 'sine=frequency=880:sample_rate=48000' \
    -vf "interlace=scan=${content_order}:lowpass=complex,setfield=${metadata_order}${aspect_filter}" \
    -t "$duration" \
    -c:v libx264 -preset ultrafast -crf 22 -flags +ilme+ildct \
    -x264-params "${metadata_order}=1" -pix_fmt yuv420p \
    -g 50 -keyint_min 50 -sc_threshold 0 \
    -c:a aac -b:a 96k -shortest \
    "$output"
}

if [[ ${COAX_SLICE7_VERIFY_EXISTING:-0} != 1 ]]; then
  stage="$temporary_directory/sports-720p50.mkv"
  encode_progressive 1280x720 50 65 24 "$stage"
  mv -f -- "$stage" "$destination/sports-720p50.mkv"

  stage="$temporary_directory/sports-720p5994.mkv"
  encode_progressive 1280x720 60000/1001 65 24 "$stage"
  mv -f -- "$stage" "$destination/sports-720p5994.mkv"

  for definition in \
    'sports-576i50-tff.mkv:720x576:tff:tff' \
    'sports-576i50-bff.mkv:720x576:bff:bff' \
    'sports-1080i50-tff.mkv:1920x1080:tff:tff' \
    'sports-1080i50-bff.mkv:1920x1080:bff:bff' \
    'sports-576i50-wrong-bff.mkv:720x576:tff:bff' \
    'sports-1080i50-wrong-tff.mkv:1920x1080:bff:tff'; do
    IFS=: read -r name size content_order metadata_order <<<"$definition"
    stage="$temporary_directory/$name"
    encode_interlaced "$size" "$content_order" "$metadata_order" 65 "$stage"
    mv -f -- "$stage" "$destination/$name"
  done

  stage="$temporary_directory/sports-soak-720p50.mkv"
  encode_progressive 1280x720 50 1870 28 "$stage"
  mv -f -- "$stage" "$destination/sports-soak-720p50.mkv"
fi

verify_stream() {
  local name=$1
  local width=$2
  local height=$3
  local rate=$4
  local field_order=$5
  local path="$destination/$name"
  local actual_width actual_height actual_rate actual_field_order rate_matches
  actual_width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 "$path")
  actual_height=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 "$path")
  actual_rate=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=nw=1:nk=1 "$path")
  actual_field_order=$(ffprobe -v error -select_streams v:0 -show_entries stream=field_order -of default=nw=1:nk=1 "$path")
  rate_matches=$(awk -v actual="$actual_rate" -v expected="$rate" 'BEGIN {
    split(actual, actual_parts, "/");
    split(expected, expected_parts, "/");
    actual_value = actual_parts[1] / actual_parts[2];
    expected_value = expected_parts[1] / expected_parts[2];
    difference = actual_value - expected_value;
    if (difference < 0) difference = -difference;
    print difference <= 0.01 ? "yes" : "no";
  }')
  if [[ $actual_width != "$width" || $actual_height != "$height" || $rate_matches != yes || $actual_field_order != "$field_order" ]]; then
    echo "Fixture verification failed for $name." >&2
    exit 1
  fi
}

verify_stream sports-720p50.mkv 1280 720 50/1 progressive
verify_stream sports-720p5994.mkv 1280 720 60000/1001 progressive
verify_stream sports-576i50-tff.mkv 720 576 25/1 tb
verify_stream sports-576i50-bff.mkv 720 576 25/1 bt
verify_stream sports-1080i50-tff.mkv 1920 1080 25/1 tb
verify_stream sports-1080i50-bff.mkv 1920 1080 25/1 bt
verify_stream sports-576i50-wrong-bff.mkv 720 576 25/1 bt
verify_stream sports-1080i50-wrong-tff.mkv 1920 1080 25/1 tb
verify_stream sports-soak-720p50.mkv 1280 720 50/1 progressive

echo "Slice 7 fixtures created and verified: 9 controlled synthetic files."

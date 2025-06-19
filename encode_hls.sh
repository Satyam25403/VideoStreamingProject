#!/bin/bash

INPUT="$1"
OUTPUT_BASE="outputs"
RESOLUTIONS=(144 240 360 480 720 1080)
BITRATES=(150k 300k 600k 1000k 2000k 4000k)
AUDIORATES=(64k 64k 96k 96k 128k 128k)

mkdir -p "$OUTPUT_BASE"

for i in "${!RESOLUTIONS[@]}"; do
    HEIGHT="${RESOLUTIONS[$i]}"
    VB="${BITRATES[$i]}"
    AB="${AUDIORATES[$i]}"
    STREAM_DIR="$OUTPUT_BASE/stream_$i"
    mkdir -p "$STREAM_DIR"

    ffmpeg -i "$INPUT" \
        -vf "scale=-2:$HEIGHT" \
        -c:v libx264 -b:v "$VB" \
        -c:a aac -b:a "$AB" \
        -f hls -hls_time 10 -hls_playlist_type vod \
        -hls_segment_filename "$STREAM_DIR/segment_%03d.ts" \
        "$STREAM_DIR/index.m3u8"
done
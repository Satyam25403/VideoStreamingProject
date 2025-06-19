OUTPUT_DIR="outputs"
MASTER_PLAYLIST="$OUTPUT_DIR/master.m3u8"

# Bandwidths and resolutions should match what you used during encoding
BANDWIDTHS=(150000 300000 600000 1000000 2000000 4000000)
RESOLUTIONS=("256x144" "426x240" "640x360" "854x480" "1280x720" "1920x1080")

echo "#EXTM3U" > "$MASTER_PLAYLIST"

for i in "${!BANDWIDTHS[@]}"; do
    BW="${BANDWIDTHS[$i]}"
    RES="${RESOLUTIONS[$i]}"
    STREAM_PATH="stream_$i/index.m3u8"

    if [ -f "$OUTPUT_DIR/$STREAM_PATH" ]; then
        echo "#EXT-X-STREAM-INF:BANDWIDTH=$BW,RESOLUTION=$RES" >> "$MASTER_PLAYLIST"
        echo "$STREAM_PATH" >> "$MASTER_PLAYLIST"
    else
        echo "⚠️ Warning: Missing $STREAM_PATH, skipping stream $i"
    fi
done

echo "✅ Master playlist generated at: $MASTER_PLAYLIST"
 
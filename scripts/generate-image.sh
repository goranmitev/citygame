#!/bin/bash
# Generate images using x.ai Grok API
# Usage: ./scripts/generate-image.sh "your prompt here" [output-filename]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../.env"

if [ -z "$XAI_API_KEY" ]; then
  echo "Error: XAI_API_KEY not set. Add it to .env"
  exit 1
fi

PROMPT="$1"
OUTPUT="${2:-public/textures/generated-$(date +%s).png}"

if [ -z "$PROMPT" ]; then
  echo "Usage: ./scripts/generate-image.sh \"your prompt\" [output-path]"
  echo ""
  echo "Examples:"
  echo "  ./scripts/generate-image.sh \"brick wall texture, seamless, tileable\""
  echo "  ./scripts/generate-image.sh \"roof tiles atlas 2x2\" public/textures/roofs.png"
  exit 1
fi

MODEL="${XAI_IMG_MODEL:-grok-imagine-image-pro}"
RESOLUTION="${XAI_IMG_RES:-1k}"
COUNT="${XAI_IMG_COUNT:-1}"

echo "Model:      $MODEL"
echo "Resolution: $RESOLUTION"
echo "Count:      $COUNT"
echo "Prompt:     $PROMPT"
echo ""

RESPONSE=$(curl -s -X POST https://api.x.ai/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d "{
    \"model\": \"$MODEL\",
    \"prompt\": \"$PROMPT\",
    \"resolution\": \"$RESOLUTION\",
    \"n\": $COUNT,
    \"response_format\": \"url\"
  }")

# Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
  echo "API Error: $RESPONSE"
  exit 1
fi

# Download each image
URLS=$(echo "$RESPONSE" | grep -o '"url":"[^"]*"' | sed 's/"url":"//;s/"//')
INDEX=0
while IFS= read -r URL; do
  if [ "$COUNT" -gt 1 ]; then
    EXT="${OUTPUT##*.}"
    BASE="${OUTPUT%.*}"
    DEST="${BASE}-${INDEX}.${EXT}"
  else
    DEST="$OUTPUT"
  fi

  curl -s -o "$DEST" "$URL"
  SIZE=$(du -h "$DEST" | cut -f1)
  echo "Saved: $DEST ($SIZE)"

  # Convert to WebP
  WEBP_DEST="${DEST%.*}.webp"
  ffmpeg -y -loglevel error -i "$DEST" -quality 85 "$WEBP_DEST"
  WEBP_SIZE=$(du -h "$WEBP_DEST" | cut -f1)
  echo "Converted: $WEBP_DEST ($WEBP_SIZE)"
  rm "$DEST"

  INDEX=$((INDEX + 1))
done <<< "$URLS"

echo "Done!"

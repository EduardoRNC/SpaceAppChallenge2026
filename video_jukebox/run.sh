#!/usr/bin/env bash
# Pipeline completo: video -> features -> MIDI -> preview WAV -> video con audio
# Uso: ./run.sh mi_video.mp4 [nombre_salida]
set -e
VIDEO="$1"
NAME="${2:-salida}"
if [ -z "$VIDEO" ]; then echo "Uso: ./run.sh video.mp4 [nombre]"; exit 1; fi
mkdir -p out

echo "1/4 Analizando video..."
python analyze.py "$VIDEO" "out/${NAME}_features.npz"

echo "2/4 Componiendo MIDI..."
python compose.py "out/${NAME}_features.npz" "out/${NAME}.mid" --events "out/${NAME}_events.json"

echo "3/4 Renderizando preview FM..."
python render_preview.py "out/${NAME}_events.json" "out/${NAME}_preview.wav"

echo "4/4 Juntando video + audio..."
ffmpeg -v error -y -i "$VIDEO" -i "out/${NAME}_preview.wav" -map 0:v -map 1:a \
  -vf scale=1280:-2 -c:v libx264 -preset veryfast -crf 24 -c:a aac -b:a 192k -shortest \
  "out/${NAME}_preview.mp4"

echo "Listo: out/${NAME}.mid (para Dexed) y out/${NAME}_preview.mp4 (para escuchar ya)"

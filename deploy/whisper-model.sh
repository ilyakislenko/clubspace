#!/bin/sh
# Downloads a whisper.cpp model into the whisper_models volume (the
# whisper-model service of docker-compose.prod.yml, run once):
#
#   docker compose -f docker-compose.prod.yml --env-file .env.production \
#     run --rm whisper-model [base|small|medium]
#
# The video worker mounts the volume read-only at /models; point
# WHISPER_MODEL_PATH at the path this prints. Pinned to one revision of the
# model repository and checked against its SHA-256, so the worker never loads
# a truncated or swapped file. Idempotent: a verified model is not downloaded
# again. All three are multilingual (Russian and English in one model):
#   small   488 MB — the default: good Russian, roughly 2–4× faster than
#           real time on 4 cores of a current x86 CPU.
#   medium  1.5 GB — better on noisy gym audio, about 3× slower than small.
#   base    148 MB — for weak CPUs (a small or old box); noticeably more
#           mistakes in technique names.
set -eu

MODEL="${1:-small}"
# huggingface.co/ggerganov/whisper.cpp — the commit the checksums below are of.
REVISION=5359861c739e955e79d9a303bcbc70fb988958b1

case "$MODEL" in
    base) SHA256=60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe ;;
    small) SHA256=1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b ;;
    medium) SHA256=6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208 ;;
    *)
        echo "unknown model «$MODEL»: base, small or medium" >&2
        exit 2
        ;;
esac

FILE="ggml-$MODEL.bin"
DEST="/models/$FILE"

if [ -f "$DEST" ] && echo "$SHA256  $DEST" | sha256sum -c -s -; then
    echo "$DEST is already there and verified"
else
    echo "downloading $FILE…"
    rm -f "$DEST.part"
    wget -O "$DEST.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/$REVISION/$FILE"
    if ! echo "$SHA256  $DEST.part" | sha256sum -c -s -; then
        rm -f "$DEST.part"
        echo "checksum mismatch for $FILE — nothing saved" >&2
        exit 1
    fi
    # Readable by the worker's non-root user.
    chmod 0644 "$DEST.part"
    mv "$DEST.part" "$DEST"
    echo "saved and verified $DEST"
fi

echo "set in .env.production: WHISPER_MODEL_PATH=$DEST"

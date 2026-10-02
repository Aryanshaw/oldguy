# source this: points Hyperframes and the spikes at the static ffmpeg/ffprobe (Homebrew's is broken on the owner's Mac)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export HYPERFRAMES_FFMPEG_PATH="$HERE/.tools/node_modules/ffmpeg-static/ffmpeg"
export HYPERFRAMES_FFPROBE_PATH="$HERE/.tools/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe"
export FFMPEG="$HYPERFRAMES_FFMPEG_PATH" FFPROBE="$HYPERFRAMES_FFPROBE_PATH"

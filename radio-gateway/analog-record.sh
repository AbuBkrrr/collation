#!/bin/sh
# Starting point for plain analog FM voice radio ("over... over"): records each transmission on ONE channel to its own .wav,
# which forward.js then uploads. Needs: rtl-sdr (rtl_fm) and sox. One RTL-SDR dongle per channel.
# Usage: ./analog-record.sh 462.5625 ./recordings [squelch 0-300, default 40] [dongle index, default 0]
# NOTE: untested here (no radio hardware). Tune the squelch value on site. For many channels inside a ~2 MHz window,
# use trunk-recorder's conventional/analog mode instead (one dongle, many channels).
FREQ=$1; DIR=${2:-./recordings}; SQ=${3:-40}; DEV=${4:-0}
[ -z "$FREQ" ] && { echo "usage: $0 <freq MHz> [dir] [squelch] [dongle]"; exit 1; }
mkdir -p "$DIR"; cd "$DIR"
rtl_fm -d "$DEV" -f "${FREQ}M" -M fm -s 12k -r 16k -l "$SQ" -E dc - | \
 sox -t raw -r 16k -e signed -b 16 -c 1 - "ch${FREQ}_.wav" silence 1 0.2 1% 1 1.5 1% : newfile : restart

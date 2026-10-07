#!/bin/sh
# Keep the collector and archive local, and draw the full dashboard in the system browser.
exec "$(dirname "$0")/stormdesk" --browser "$@"

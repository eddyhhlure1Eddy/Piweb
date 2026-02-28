#!/bin/bash
# Install PIweb as a systemd user service (auto-start on boot, auto-restart on crash)

set -e

SERVICE_FILE="piweb.service"
USER_SERVICE_DIR="$HOME/.config/systemd/user"

echo "=== Installing PIweb systemd service ==="

# Create user systemd dir
mkdir -p "$USER_SERVICE_DIR"

# Copy service file
cp "$SERVICE_FILE" "$USER_SERVICE_DIR/piweb.service"
echo "Copied service file to $USER_SERVICE_DIR/"

# Reload systemd
systemctl --user daemon-reload
echo "Reloaded systemd daemon"

# Enable (auto-start on login)
systemctl --user enable piweb.service
echo "Enabled piweb.service (auto-start)"

# Enable lingering (start service even without login session)
sudo loginctl enable-linger "$(whoami)"
echo "Enabled linger (service runs without login)"

# Start now
systemctl --user start piweb.service
echo "Started piweb.service"

# Show status
sleep 2
systemctl --user status piweb.service --no-pager

echo ""
echo "=== Done! ==="
echo "Commands:"
echo "  systemctl --user status piweb   # check status"
echo "  systemctl --user restart piweb  # restart"
echo "  systemctl --user stop piweb     # stop"
echo "  journalctl --user -u piweb -f   # view logs"

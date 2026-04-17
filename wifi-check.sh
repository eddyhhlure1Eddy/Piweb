#!/bin/bash
# PiWeb WiFi check — run before PiWeb starts
# If no WiFi connection within MAX_WAIT seconds, start hotspot for provisioning

MAX_WAIT=15

echo "[PiWeb WiFi] Checking network..."

for i in $(seq 1 $MAX_WAIT); do
  IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet )\S+(?=/)')
  # Skip hotspot IP (10.42.0.1)
  if [ -n "$IP" ] && [ "$IP" != "10.42.0.1" ]; then
    echo "[PiWeb WiFi] Connected: $IP"
    exit 0
  fi
  sleep 1
done

# No WiFi — start hotspot
echo "[PiWeb WiFi] No WiFi detected, starting provisioning hotspot..."
nmcli dev wifi hotspot ifname wlan0 ssid "PiWeb-Setup" password "piweb123"
echo "[PiWeb WiFi] Hotspot active: PiWeb-Setup (password: piweb123)"
echo "[PiWeb WiFi] Connect to hotspot and open http://10.42.0.1:3000"

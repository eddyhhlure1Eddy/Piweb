#!/usr/bin/env python3
"""
Standalone WiFi Manager for PiWeb — zero-dependency, ultra-lightweight.

Runs on port 8080 as a system-level systemd service.
Survives PiWeb crashes. Provides WiFi scan/connect/status/hotspot.
Uses only Python stdlib (no Flask, no pip).

Usage:
  python3 wifi-manager.py              # start server on :8080
  python3 wifi-manager.py --port 9090  # custom port
"""

import json
import subprocess
import time
import os
import sys
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('WIFI_MANAGER_PORT', '8080'))

# --- Network helpers (nmcli wrappers) ---

def run_cmd(args, timeout=15):
    """Run command, return (stdout, stderr, returncode)."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.stdout, r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        return '', 'timeout', -1
    except Exception as e:
        return '', str(e), -1

def get_current_ssid():
    out, _, rc = run_cmd(['nmcli', '-t', '-f', 'active,ssid', 'dev', 'wifi'])
    if rc != 0:
        return None
    for line in out.strip().split('\n'):
        if line.startswith('yes:'):
            ssid = line[4:]
            return ssid if ssid else None
    return None

def get_current_ip():
    out, _, rc = run_cmd(['ip', '-4', 'addr', 'show', 'wlan0'])
    if rc != 0:
        return None
    import re
    m = re.search(r'inet\s+(\d+\.\d+\.\d+\.\d+)', out)
    return m.group(1) if m else None

def get_hostname():
    out, _, rc = run_cmd(['hostname'])
    return out.strip() if rc == 0 else None

def is_hotspot():
    out, _, rc = run_cmd(['nmcli', '-t', '-f', 'NAME,TYPE', 'connection', 'show', '--active'])
    return 'Hotspot' in out if rc == 0 else False

def scan_networks():
    # Trigger rescan (ignore errors)
    run_cmd(['nmcli', 'dev', 'wifi', 'rescan'], timeout=5)
    time.sleep(2)

    out, _, rc = run_cmd(['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY,ACTIVE', 'dev', 'wifi', 'list'])
    if rc != 0:
        return []

    networks = []
    for line in out.strip().split('\n'):
        if not line.strip():
            continue
        parts = line.split(':')
        if len(parts) < 4:
            continue
        active = parts.pop()
        security = parts.pop()
        signal = parts.pop()
        ssid = ':'.join(parts)  # SSID may contain colons
        if not ssid:
            continue
        networks.append({
            'ssid': ssid,
            'signal': int(signal) if signal.isdigit() else 0,
            'security': security or 'Open',
            'connected': active == 'yes',
        })

    # Deduplicate: keep strongest signal per SSID
    best = {}
    for n in networks:
        key = n['ssid']
        if key not in best or n['connected'] or n['signal'] > best[key]['signal']:
            best[key] = n
    return sorted(best.values(), key=lambda x: -x['signal'])

def wifi_status():
    ip = get_current_ip()
    ssid = get_current_ssid()
    hotspot = is_hotspot()
    hostname = get_hostname()
    return {
        'connected': bool(ip) and not hotspot,
        'ip': ip,
        'ssid': 'PiWeb-Setup (Hotspot)' if hotspot else ssid,
        'url': f'http://{ip}:3000' if ip else None,
        'hostname': hostname,
        'hotspot': hotspot,
    }

# --- WiFi switch (runs in background thread) ---

_switch_lock = threading.Lock()
_switch_result = {'status': 'none'}

def do_switch(ssid, password, prev_ssid):
    """Perform WiFi switch in background thread."""
    global _switch_result

    _switch_result = {
        'targetSSID': ssid,
        'status': 'switching',
        'ip': None,
        'error': None,
        'timestamp': int(time.time() * 1000),
    }

    # Wait for HTTP response to reach client
    time.sleep(3)

    try:
        # Try saved profile first (match by SSID substring, e.g. "netplan-wlan0-Xiaomi_CC26")
        connected = False
        saved = find_saved_connection(ssid)
        if saved:
            print(f'[WiFi] Found saved connection: {saved}')
            _, err, rc = run_cmd(['nmcli', 'connection', 'up', saved, 'ifname', 'wlan0'], timeout=15)
            if rc == 0:
                connected = True

        if not connected:
            # Fresh connect with password
            args = ['nmcli', 'dev', 'wifi', 'connect', ssid]
            if password:
                args += ['password', password]
            args += ['ifname', 'wlan0']
            _, err, rc = run_cmd(args, timeout=30)
            if rc != 0:
                raise Exception(err.strip() or 'nmcli connect failed')

        # Wait for DHCP
        ip = None
        for _ in range(6):  # up to 9s
            time.sleep(1.5)
            ip = get_current_ip()
            if ip:
                break

        if not ip:
            raise Exception('Connected but no IP (DHCP timeout)')

        _switch_result = {
            'targetSSID': ssid,
            'status': 'connected',
            'ip': ip,
            'error': None,
            'timestamp': int(time.time() * 1000),
        }
        print(f'[WiFi] Switched to {ssid}, IP: {ip}')

    except Exception as e:
        err_msg = str(e)
        print(f'[WiFi] Switch failed: {err_msg}')

        # Rollback
        rolled_back = False
        if prev_ssid:
            _, _, rc = run_cmd(['nmcli', 'connection', 'up', prev_ssid, 'ifname', 'wlan0'], timeout=15)
            if rc == 0:
                time.sleep(3)
                ip = get_current_ip()
                if ip:
                    rolled_back = True
                    print(f'[WiFi] Rolled back to {prev_ssid}, IP: {ip}')

        if not rolled_back:
            # Start hotspot as last resort
            run_cmd(['nmcli', 'dev', 'disconnect', 'wlan0'], timeout=5)
            run_cmd(['nmcli', 'dev', 'wifi', 'hotspot', 'ifname', 'wlan0',
                     'ssid', 'PiWeb-Setup', 'password', 'piweb123'], timeout=15)
            print('[WiFi] Hotspot started as fallback')

        _switch_result = {
            'targetSSID': ssid,
            'status': 'rolled_back' if rolled_back else 'failed',
            'ip': get_current_ip(),
            'error': err_msg,
            'timestamp': int(time.time() * 1000),
        }

def find_saved_connection(ssid):
    """Find saved nmcli connection name matching an SSID."""
    out, _, rc = run_cmd(['nmcli', '-t', '-f', 'NAME', 'connection', 'show'])
    if rc != 0:
        return None
    # Exact match first, then substring match
    names = [n.strip() for n in out.strip().split('\n') if n.strip()]
    for name in names:
        if name == ssid:
            return name
    for name in names:
        if ssid in name:
            return name
    return None

def start_hotspot():
    run_cmd(['nmcli', 'dev', 'disconnect', 'wlan0'], timeout=5)
    _, err, rc = run_cmd(['nmcli', 'dev', 'wifi', 'hotspot', 'ifname', 'wlan0',
                          'ssid', 'PiWeb-Setup', 'password', 'piweb123'], timeout=15)
    if rc == 0:
        return {'success': True}
    return {'success': False, 'error': err.strip()}

# --- HTTP Handler ---

HTML_PAGE = '''<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WiFi Manager</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#1a1a2e;color:#e0e0e0;padding:16px;max-width:480px;margin:0 auto}
h1{font-size:20px;margin-bottom:12px;color:#00d2ff}
.card{background:#16213e;border-radius:8px;padding:12px;margin-bottom:12px}
.status{display:flex;justify-content:space-between;align-items:center}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:6px}
.green{background:#00ff88}.red{background:#ff4444}.yellow{background:#ffaa00}
button{background:#0f3460;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px;width:100%;margin-top:8px}
button:hover{background:#1a5276}
button:disabled{opacity:0.5;cursor:not-allowed}
.net{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1a1a2e}
.net:last-child{border:none}
.signal{font-size:12px;color:#888}
input{background:#0f3460;color:#fff;border:1px solid #333;padding:8px;border-radius:4px;width:100%;margin-top:4px}
.msg{padding:8px;border-radius:4px;margin-top:8px;font-size:13px}
.msg.ok{background:#0a3d0a}.msg.err{background:#3d0a0a}
#switchStatus{margin-top:8px;font-size:13px;color:#ffaa00}
</style>
</head><body>
<h1>WiFi Manager</h1>

<div class="card">
<div class="status" id="statusBar">Loading...</div>
</div>

<div class="card">
<button onclick="doScan()" id="scanBtn">Scan Networks</button>
<div id="networks"></div>
</div>

<div class="card">
<button onclick="doHotspot()">Start Hotspot (PiWeb-Setup)</button>
</div>

<div id="switchStatus"></div>
<div id="msgBox"></div>

<script>
const API = location.origin;
let switchPoll = null;
let lastNets = [];

async function loadStatus() {
  try {
    const r = await fetch(API + "/status");
    const s = await r.json();
    const dot = s.connected ? "green" : s.hotspot ? "yellow" : "red";
    const label = s.hotspot ? "Hotspot" : (s.connected ? s.ssid : "Disconnected");
    document.getElementById("statusBar").innerHTML =
      "<span><span class=\\"dot " + dot + "\\"></span>" + label + "</span>" +
      "<span>" + (s.ip || "--") + "</span>";
  } catch(e) {
    document.getElementById("statusBar").textContent = "Error loading status";
  }
}

async function doScan() {
  var btn = document.getElementById("scanBtn");
  btn.disabled = true; btn.textContent = "Scanning...";
  try {
    var r = await fetch(API + "/scan");
    var data = await r.json();
    lastNets = data.networks;
    var div = document.getElementById("networks");
    var html = "";
    for (var i = 0; i < lastNets.length; i++) {
      var n = lastNets[i];
      var prefix = n.connected ? ">>> " : "";
      html += "<div class=\\"net\\" onclick=\\"promptConnect(" + i + ")\\">" +
        "<span>" + prefix + n.ssid + "</span>" +
        "<span class=\\"signal\\">" + n.signal + "% " + n.security + "</span></div>";
    }
    div.innerHTML = html;
  } catch(e) { showMsg("Scan failed: " + e.message, true); }
  btn.disabled = false; btn.textContent = "Scan Networks";
}

function promptConnect(idx) {
  var n = lastNets[idx];
  if (!n) return;
  var pw = prompt("Password for " + n.ssid + " (leave empty if open):");
  if (pw === null) return;
  doConnect(n.ssid, pw);
}

async function doConnect(ssid, password) {
  showMsg("Switching to " + ssid + "...", false);
  try {
    var r = await fetch(API + "/connect", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ssid: ssid, password: password})
    });
    var data = await r.json();
    if (data.accepted) {
      document.getElementById("switchStatus").textContent = "Switch initiated, waiting...";
      startSwitchPoll(ssid);
    }
  } catch(e) {
    showMsg("Request failed (expected if network changed)", true);
    startSwitchPoll(ssid);
  }
}

function tryFetch(url, timeout) {
  return fetch(url, {signal: AbortSignal.timeout(timeout || 3000)})
    .then(function(r) { return r.json(); })
    .catch(function() { return null; });
}

function startSwitchPoll(targetSSID) {
  if (switchPoll) clearInterval(switchPoll);

  var el = document.getElementById("switchStatus");
  // Step 1: Tell user to switch their device
  el.innerHTML = "<div style=\\"background:#16213e;padding:12px;border-radius:8px;margin-top:12px\\">" +
    "<div style=\\"color:#00d2ff;font-size:16px;margin-bottom:8px\\">Pi is switching to: " + targetSSID + "</div>" +
    "<div style=\\"color:#ffaa00;font-size:14px;margin-bottom:12px\\">Please connect YOUR device to <b>" + targetSSID + "</b> too</div>" +
    "<button onclick=\\"startScanning()\\" style=\\"background:#0f3460;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:14px;cursor:pointer;width:100%\\">I have connected, find Pi</button>" +
    "<div id=\\"scanProgress\\" style=\\"margin-top:8px;font-size:12px;color:#888\\"></div>" +
    "</div>";
}

function startScanning() {
  var el = document.getElementById("scanProgress");
  if (!el) return;
  el.textContent = "Scanning...";
  var attempts = 0;
  var found = false;

  // Build candidate IPs from common subnets
  var subnets = ["192.168.0.", "192.168.1.", "192.168.2.", "192.168.50.", "10.0.0."];
  var candidates = [];
  for (var s = 0; s < subnets.length; s++) {
    for (var i = 1; i <= 254; i++) {
      candidates.push(subnets[s] + i);
    }
  }

  // Also try mDNS
  var mdns = "http://raspberrypi.local:8080/status";

  var batchSize = 40;
  var idx = 0;
  var pass = 0;

  async function scanBatch() {
    if (found) return;

    // Try mDNS every batch
    var mdnsResult = await tryFetch(mdns, 2000);
    if (mdnsResult && mdnsResult.ip) {
      found = true;
      redirectToPiWeb(mdnsResult.ip);
      return;
    }

    // Scan a batch of IPs
    var batch = candidates.slice(idx, idx + batchSize);
    idx += batchSize;
    attempts++;

    if (batch.length === 0) {
      pass++;
      idx = 0;
      if (pass >= 3) {
        el.textContent = "Pi not found after 3 passes. Check your network connection.";
        el.style.color = "#ff4444";
        return;
      }
      el.textContent = "Pass " + (pass + 1) + "...";
      setTimeout(scanBatch, 1000);
      return;
    }

    el.textContent = "Scanning: " + idx + "/" + candidates.length + " (pass " + (pass + 1) + ")";

    var promises = batch.map(function(ip) {
      return tryFetch("http://" + ip + ":3000/api/wifi/status", 2000).then(function(data) {
        if (!found && data && data.ip) {
          found = true;
          redirectToPiWeb(data.ip);
        }
      });
    });
    await Promise.all(promises);

    if (!found) setTimeout(scanBatch, 100);
  }

  scanBatch();
}

function redirectToPiWeb(ip) {
  var el = document.getElementById("switchStatus");
  el.innerHTML = "<div style=\\"background:#0a3d0a;padding:12px;border-radius:8px;margin-top:12px;\\">" +
    "<div style=\\"color:#00ff88;font-size:16px\\">Found PiWeb at " + ip + "</div>" +
    "<div style=\\"margin-top:4px\\">Redirecting to http://" + ip + ":3000/ ...</div></div>";
  setTimeout(function() { window.location.href = "http://" + ip + ":3000/"; }, 1500);
}

async function doHotspot() {
  try {
    var r = await fetch(API + "/hotspot", {method:"POST"});
    var data = await r.json();
    showMsg(data.success ? "Hotspot started: PiWeb-Setup / piweb123" : "Failed: " + data.error, !data.success);
    setTimeout(loadStatus, 2000);
  } catch(e) { showMsg("Error: " + e.message, true); }
}

function showMsg(text, isErr) {
  var el = document.getElementById("msgBox");
  el.className = "msg " + (isErr ? "err" : "ok");
  el.textContent = text;
  setTimeout(function() { el.textContent = ""; }, 8000);
}

loadStatus();
setInterval(loadStatus, 10000);
</script>
</body></html>'''

class WifiHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f'[WiFi] {args[0]}')

    def _json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, html):
        body = html.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path

        if path == '/' or path == '':
            self._html(HTML_PAGE)
        elif path == '/status':
            self._json(wifi_status())
        elif path == '/scan':
            self._json({'networks': scan_networks()})
        elif path == '/switch-result':
            self._json(_switch_result)
        else:
            self._json({'error': 'not found'}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len).decode() if content_len > 0 else '{}'

        if path == '/connect':
            try:
                data = json.loads(body)
                ssid = data.get('ssid', '')
                password = data.get('password', '')
            except:
                self._json({'error': 'invalid json'}, 400)
                return

            if not ssid:
                self._json({'error': 'ssid required'}, 400)
                return

            # Check if switch already in progress
            if _switch_result.get('status') == 'switching':
                age = time.time() * 1000 - _switch_result.get('timestamp', 0)
                if age < 120000:
                    self._json({'error': 'switch already in progress', 'accepted': False})
                    return

            prev_ssid = get_current_ssid()

            # Send response FIRST, then switch in background
            self._json({'accepted': True, 'delay': 3})

            # Background thread for the actual switch
            if _switch_lock.acquire(blocking=False):
                t = threading.Thread(target=lambda: _do_switch_locked(ssid, password, prev_ssid), daemon=True)
                t.start()
            else:
                print('[WiFi] Switch lock busy, ignoring')

        elif path == '/hotspot':
            self._json(start_hotspot())
        else:
            self._json({'error': 'not found'}, 404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def _do_switch_locked(ssid, password, prev_ssid):
    try:
        do_switch(ssid, password, prev_ssid)
    finally:
        _switch_lock.release()

# --- Main ---

def main():
    port = PORT
    if '--port' in sys.argv:
        idx = sys.argv.index('--port')
        if idx + 1 < len(sys.argv):
            port = int(sys.argv[idx + 1])

    server = HTTPServer(('0.0.0.0', port), WifiHandler)
    print(f'[WiFi Manager] Running at http://0.0.0.0:{port}')
    print(f'[WiFi Manager] PID: {os.getpid()}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[WiFi Manager] Shutting down')
        server.shutdown()

if __name__ == '__main__':
    main()

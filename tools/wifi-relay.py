#!/usr/bin/env python3
"""
PiWeb WiFi Relay — background daemon for safe WiFi switching.
Completely decoupled from the web server.

When PiWeb needs to switch WiFi, it writes a command file.
This relay picks it up, performs the switch via nmcli, writes the result.
The web server and browser can be dead during the switch — doesn't matter.

IPC (file-based, atomic writes):
  Command:   /tmp/piweb-wifi-cmd.json   (written by PiWeb)
  Result:    /tmp/piweb-wifi-result.json (written by relay)
  Heartbeat: /tmp/piweb-wifi-alive       (mtime = relay is alive)

Run: python3 tools/wifi-relay.py
     or as systemd service (see wifi-relay.service)
"""

import json
import os
import re
import secrets
import subprocess
import sys
import time
import signal
from pathlib import Path

CMD_FILE = '/tmp/piweb-wifi-cmd.json'
RESULT_FILE = '/tmp/piweb-wifi-result.json'
ALIVE_FILE = '/tmp/piweb-wifi-alive'
POLL_INTERVAL = 1
SWITCH_DELAY = 2  # seconds before switching, let HTTP response reach browser
DHCP_WAIT = 4
DHCP_RETRY = 3
HOTSPOT_SSID = os.environ.get('PIWEB_HOTSPOT_SSID', 'PiWeb-Setup')
HOTSPOT_PASSWORD_FILE = os.environ.get('PIWEB_HOTSPOT_PASSWORD_FILE') or str(Path.home() / '.piweb-hotspot-password')

running = True

def sig_handler(signum, frame):
    global running
    running = False

signal.signal(signal.SIGTERM, sig_handler)
signal.signal(signal.SIGINT, sig_handler)


def log(msg):
    ts = time.strftime('%H:%M:%S')
    print(f'[wifi-relay {ts}] {msg}', flush=True)


def run(args, timeout=10):
    """Run command, return (returncode, stdout, stderr)"""
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, '', 'timeout'
    except Exception as e:
        return -1, '', str(e)


def valid_hotspot_password(value):
    return bool(re.fullmatch(r'[A-Za-z0-9_-]{8,63}', value or ''))


def get_hotspot_password():
    env_password = os.environ.get('PIWEB_HOTSPOT_PASSWORD', '').strip()
    if env_password:
        if not valid_hotspot_password(env_password):
            raise Exception('PIWEB_HOTSPOT_PASSWORD must be 8-63 chars using letters, numbers, "_" or "-"')
        return env_password

    path = Path(HOTSPOT_PASSWORD_FILE)
    try:
        if path.exists():
            existing = path.read_text().strip()
            if valid_hotspot_password(existing):
                return existing
    except Exception:
        pass

    generated = secrets.token_hex(12)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(generated + '\n')
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass
    return generated


def get_ssid():
    code, out, _ = run(['nmcli', '-t', '-f', 'active,ssid', 'dev', 'wifi'])
    if code == 0:
        for line in out.strip().split('\n'):
            if line.startswith('yes:'):
                ssid = line[4:]
                return ssid if ssid else None
    return None


def get_ip():
    code, out, _ = run(['ip', '-4', 'addr', 'show', 'wlan0'])
    if code == 0:
        m = re.search(r'inet\s+(\d+\.\d+\.\d+\.\d+)/(\d+)', out)
        if m:
            return m.group(1), m.group(2)  # ip, prefix_len
    return None, None


def get_subnet(ip, prefix_len):
    """Derive subnet string like 192.168.2.0/24"""
    if not ip or not prefix_len:
        return None
    parts = ip.split('.')
    if len(parts) == 4:
        prefix = int(prefix_len)
        if prefix <= 8:
            return f'{parts[0]}.0.0.0/{prefix}'
        elif prefix <= 16:
            return f'{parts[0]}.{parts[1]}.0.0/{prefix}'
        elif prefix <= 24:
            return f'{parts[0]}.{parts[1]}.{parts[2]}.0/{prefix}'
        else:
            return f'{ip}/{prefix}'
    return None


def do_connect(ssid, password):
    """Try connecting: saved profile first, then fresh connect."""
    # Try saved profile
    code, _, err = run(['nmcli', 'connection', 'up', ssid, 'ifname', 'wlan0'], timeout=15)
    if code == 0:
        log(f'Connected via saved profile: {ssid}')
        return True

    # Fresh connect with password
    args = ['nmcli', 'dev', 'wifi', 'connect', ssid]
    if password:
        args += ['password', password]
    args += ['ifname', 'wlan0']
    code, _, err = run(args, timeout=30)
    if code == 0:
        log(f'Connected via fresh connect: {ssid}')
        return True

    raise Exception(err.strip() or f'nmcli failed (code {code})')


def start_hotspot():
    run(['nmcli', 'dev', 'disconnect', 'wlan0'], timeout=5)
    hotspot_password = get_hotspot_password()
    code, _, err = run([
        'nmcli', 'dev', 'wifi', 'hotspot',
        'ifname', 'wlan0', 'ssid', HOTSPOT_SSID, 'password', hotspot_password
    ], timeout=15)
    if code == 0:
        log(f'Hotspot started: {HOTSPOT_SSID}')
        return True
    log(f'Hotspot failed: {err}')
    return False


def rollback(prev_ssid):
    """Try previous WiFi, then hotspot as last resort."""
    if prev_ssid:
        log(f'Rolling back to: {prev_ssid}')
        code, _, _ = run(['nmcli', 'connection', 'up', prev_ssid, 'ifname', 'wlan0'], timeout=15)
        if code == 0:
            time.sleep(DHCP_WAIT)
            ip, _ = get_ip()
            if ip:
                log(f'Rollback OK — IP: {ip}')
                return True
            log('Rollback connected but no IP')
        else:
            log(f'Rollback to {prev_ssid} failed')

    log('Starting hotspot as fallback')
    return start_hotspot()


def write_result(data):
    """Atomic write: tmp + rename"""
    tmp = RESULT_FILE + '.tmp'
    try:
        with open(tmp, 'w') as f:
            json.dump(data, f)
        os.rename(tmp, RESULT_FILE)
    except Exception as e:
        log(f'Failed to write result: {e}')


def handle_switch(cmd):
    ssid = cmd.get('ssid', '').strip()
    password = cmd.get('password', '')

    if not ssid:
        write_result({'status': 'failed', 'error': 'No SSID', 'ts': int(time.time())})
        return

    log(f'=== WiFi switch requested: {ssid} ===')
    write_result({'ssid': ssid, 'status': 'switching', 'ts': int(time.time())})

    # Delay to let HTTP response reach the browser
    time.sleep(SWITCH_DELAY)

    prev_ssid = get_ssid()
    log(f'Current: {prev_ssid or "(none)"} → Target: {ssid}')

    try:
        # Tear down hotspot if active
        run(['nmcli', 'connection', 'down', 'Hotspot'], timeout=5)

        do_connect(ssid, password)

        # Wait for DHCP
        time.sleep(DHCP_WAIT)
        ip, prefix = get_ip()

        # Retry once if DHCP slow
        if not ip:
            log('No IP yet, retrying...')
            time.sleep(DHCP_RETRY)
            ip, prefix = get_ip()

        if not ip:
            raise Exception('Connected but DHCP timeout — no IP obtained')

        subnet = get_subnet(ip, prefix)
        result = {
            'ssid': ssid,
            'status': 'connected',
            'ip': ip,
            'subnet': subnet,
            'url': f'http://{ip}:3000',
            'ts': int(time.time()),
        }
        write_result(result)
        log(f'SUCCESS — SSID: {ssid} | IP: {ip} | Subnet: {subnet}')

    except Exception as e:
        err_msg = str(e)
        log(f'FAILED: {err_msg}')

        rb_ok = rollback(prev_ssid)
        rb_ip, rb_prefix = get_ip()
        result = {
            'ssid': ssid,
            'status': 'rolled_back' if rb_ok else 'failed',
            'error': err_msg,
            'ip': rb_ip,
            'subnet': get_subnet(rb_ip, rb_prefix) if rb_ip else None,
            'ts': int(time.time()),
        }
        write_result(result)


def touch_alive():
    try:
        with open(ALIVE_FILE, 'w') as f:
            f.write(str(int(time.time())))
    except:
        pass


def main():
    log('Started — watching for commands')
    last_mtime = 0
    heartbeat_counter = 0

    while running:
        try:
            # Heartbeat every 5 seconds
            heartbeat_counter += 1
            if heartbeat_counter >= 5:
                touch_alive()
                heartbeat_counter = 0

            # Check for new command
            if os.path.exists(CMD_FILE):
                mtime = os.path.getmtime(CMD_FILE)
                if mtime > last_mtime:
                    last_mtime = mtime
                    try:
                        with open(CMD_FILE) as f:
                            cmd = json.load(f)
                    except:
                        cmd = {}

                    # Process command
                    action = cmd.get('cmd', '')
                    if action == 'switch':
                        handle_switch(cmd)
                    elif action == 'reconnect':
                        log('Auto-reconnect requested (from watchdog)')
                        write_result({'status': 'switching', 'ts': int(time.time())})
                        code, _, _ = run(['nmcli', 'dev', 'connect', 'wlan0'], timeout=20)
                        time.sleep(DHCP_WAIT)
                        ip, prefix = get_ip()
                        ssid = get_ssid()
                        if code == 0 and ip:
                            log(f'Auto-reconnect OK — {ssid} @ {ip}')
                            write_result({
                                'ssid': ssid or 'auto',
                                'status': 'connected',
                                'ip': ip,
                                'subnet': get_subnet(ip, prefix),
                                'ts': int(time.time()),
                            })
                        else:
                            log('Auto-reconnect failed')
                            write_result({
                                'ssid': ssid or 'auto',
                                'status': 'failed',
                                'error': 'Auto-reconnect failed',
                                'ts': int(time.time()),
                            })
                    elif action == 'hotspot':
                        log('Hotspot requested')
                        ok = start_hotspot()
                        ip, prefix = get_ip()
                        write_result({
                            'ssid': HOTSPOT_SSID,
                            'status': 'connected' if ok else 'failed',
                            'ip': ip or '10.42.0.1',
                            'subnet': '10.42.0.0/24',
                            'hotspot': True,
                            'ts': int(time.time()),
                        })
                    else:
                        log(f'Unknown command: {action}')

                    # Remove processed command
                    try:
                        os.unlink(CMD_FILE)
                    except:
                        pass

        except Exception as e:
            log(f'Loop error: {e}')

        time.sleep(POLL_INTERVAL)

    log('Stopped')
    # Cleanup
    for f in [ALIVE_FILE]:
        try:
            os.unlink(f)
        except:
            pass


if __name__ == '__main__':
    main()

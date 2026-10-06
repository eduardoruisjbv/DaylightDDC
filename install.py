#!/usr/bin/env python3
"""Install for the current user; --start starts the service with automation off."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--start', action='store_true', help='Enable and start the user service (does not enable scheduling)')
parser.add_argument('--without-extension', action='store_true', help='Install only the universal service and CLI')
args = parser.parse_args()
home = Path.home()
data = Path(os.environ.get('XDG_DATA_HOME', home / '.local/share'))
config = Path(os.environ.get('XDG_CONFIG_HOME', home / '.config'))
installed = data / 'daylight-ddc/daylight-ddc.py'
launcher = home / '.local/bin/daylight-ddc'
if launcher.exists() or launcher.is_symlink():
    if not launcher.is_symlink() or launcher.resolve() != installed.resolve():
        parser.error(f'Refusing to replace unrelated launcher: {launcher}')
installed.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(ROOT / 'service/daylight-ddc.py', installed)
installed.chmod(0o755)
launcher.parent.mkdir(parents=True, exist_ok=True)
if not launcher.is_symlink():
    launcher.symlink_to(installed)
# systemd's ExecStart syntax uses quoted words and doubles percent specifiers.
def quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
unit = config / 'systemd/user/daylight-ddc.service'
unit.parent.mkdir(parents=True, exist_ok=True)
unit.write_text('[Unit]\nDescription=Daylight DDC monitor brightness scheduler\n\n'
                '[Service]\nType=dbus\nBusName=io.github.daylightddc.Service\n'
                f'ExecStart={quote(installed)} serve\nRestart=on-failure\nRestartSec=5\n'
                'TimeoutStopSec=5\n\n[Install]\nWantedBy=default.target\n')
bus = data / 'dbus-1/services/io.github.daylightddc.Service.service'
bus.parent.mkdir(parents=True, exist_ok=True)
bus.write_text('[D-BUS Service]\nName=io.github.daylightddc.Service\n'
               f'Exec="{str(installed).replace(chr(34), chr(92) + chr(34))}" serve\n'
               'SystemdService=daylight-ddc.service\n')
if not args.without_extension:
    extension = data / 'gnome-shell/extensions/daylight-ddc@local'
    shutil.copytree(ROOT / 'extension', extension, dirs_exist_ok=True)
subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
if args.start:
    subprocess.run(['systemctl', '--user', 'enable', '--now', 'daylight-ddc.service'], check=True)
print(f'Installed service and CLI: {launcher}')
print('Scheduling starts disabled on first use; enable it with: daylight-ddc automatic on')
if not args.without_extension:
    print('Enable GNOME controls after logging out/in: gnome-extensions enable daylight-ddc@local')

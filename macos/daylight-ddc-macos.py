#!/usr/bin/env python3
"""DaylightDDC macOS Intel controller using per-display relative ranges."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path.home() / "Library/Application Support/DaylightDDC"
CONFIG = Path.home() / "Library/Application Support/DaylightDDC/config.json"
LOG = Path.home() / "Library/Logs/DaylightDDC.log"
DDCCTL = os.environ.get("DDCCTL") or shutil.which("ddcctl") or "/usr/local/bin/ddcctl"
PROFILES = {
    "natural": [(360, 0), (720, 100), (1080, 0)],
    "curtains": [(270, 0), (360, 35), (1080, 35), (1200, 35), (1320, 28)],
    "apple_like": [(360, 28), (540, 44), (720, 54), (960, 53), (1140, 45), (1320, 35), (0, 29)],
    "custom": [(360, 26), (480, 38), (600, 50), (720, 55), (1020, 52), (1140, 44), (1320, 34), (0, 28)],
}


def defaults():
    return {"automatic": False, "profile": "natural", "monitors": [],
            "schedule": {name: [{"time": f"{minute // 60:02d}:{minute % 60:02d}", "brightness": level}
                                for minute, level in points]
                         for name, points in PROFILES.items()}}


def read_config():
    if not CONFIG.exists():
        return defaults()
    value = json.loads(CONFIG.read_text())
    if not isinstance(value, dict) or not isinstance(value.get("monitors"), list):
        raise ValueError(f"Invalid configuration at {CONFIG}")
    return value


def save(config):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    temp = CONFIG.with_suffix(".tmp")
    temp.write_text(json.dumps(config, indent=2) + "\n")
    temp.chmod(0o600)
    temp.replace(CONFIG)


def relative_to_monitor(level, monitor):
    """Map shared relative brightness into this monitor's individually tuned range."""
    low, high = int(monitor["min"]), int(monitor["max"])
    return round(low + (high - low) * max(0, min(100, level)) / 100)


def scheduled_target(config, now=None):
    now = now or dt.datetime.now()
    points = config["schedule"][config["profile"]]
    parsed = sorted((int(item["time"][:2]) * 60 + int(item["time"][3:]), item["brightness"])
                    for item in points)
    current = now.hour * 60 + now.minute + now.second / 60
    extended = [(parsed[-1][0] - 1440, parsed[-1][1]), *parsed,
                (parsed[0][0] + 1440, parsed[0][1])]
    for (start, first), (end, last) in zip(extended, extended[1:]):
        if start <= current < end:
            return round(first + (last - first) * (current - start) / (end - start))
    return 0


def apply(config, level):
    failures = []
    for monitor in config["monitors"]:
        display = int(monitor["display"])
        mapped = relative_to_monitor(level, monitor)
        try:
            subprocess.run([DDCCTL, "-d", str(display), "-b", str(mapped)],
                           check=True, capture_output=True, text=True, timeout=20)
            print(f"{monitor['name']} (display {display}): relative {level}% → DDC {mapped}%")
        except (OSError, subprocess.SubprocessError) as exc:
            failures.append(f"{monitor['name']} (display {display}): {exc}")
    if failures:
        raise RuntimeError("\n".join(failures))


def log(message):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as stream:
        stream.write(f"{dt.datetime.now().isoformat(timespec='seconds')} {message}\n")


def serve():
    last_level = None
    last_signature = None
    while True:
        try:
            config = read_config()
            override = config.get("manual_override")
            if override and override.get("until", 0) <= time.time():
                config.pop("manual_override", None)
                save(config)
                override = None
            if config.get("monitors") and (config.get("automatic") or override):
                level = override["brightness"] if override else scheduled_target(config)
                signature = json.dumps({"monitors": config["monitors"], "automatic": config["automatic"],
                                        "profile": config["profile"], "schedule": config["schedule"],
                                        "override": override}, sort_keys=True)
                if level != last_level or signature != last_signature:
                    apply(config, level)
                    last_level = level
                    last_signature = signature
        except Exception as exc:
            log(f"ERROR {exc}")
        time.sleep(30)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve")
    sub.add_parser("status")
    automatic = sub.add_parser("automatic")
    automatic.add_argument("mode", choices=("on", "off"))
    profile = sub.add_parser("profile")
    profile.add_argument("name", choices=sorted(PROFILES))
    brightness = sub.add_parser("brightness")
    brightness.add_argument("relative", type=int, choices=range(101))
    brightness.add_argument("--minutes", type=int, default=60)
    sub.add_parser("resume")
    monitor = sub.add_parser("monitor")
    monitor_sub = monitor.add_subparsers(dest="monitor_command", required=True)
    add = monitor_sub.add_parser("add", help="add a display with its own calibrated DDC range")
    add.add_argument("display", type=int, help="ddcctl display number, starting at 1")
    add.add_argument("name")
    add.add_argument("--min", dest="minimum", type=int, required=True, help="comfortable low DDC value (1–100)")
    add.add_argument("--max", dest="maximum", type=int, required=True, help="comfortable high DDC value (1–100)")
    monitor_sub.add_parser("list")
    remove = monitor_sub.add_parser("remove")
    remove.add_argument("display", type=int)
    args = parser.parse_args()
    if args.command == "serve":
        serve()
        return
    config = read_config()
    if args.command == "monitor":
        if args.monitor_command == "add":
            if not 1 <= args.minimum <= args.maximum <= 100:
                parser.error("Require 1 <= --min <= --max <= 100")
            config["monitors"] = [m for m in config["monitors"] if m["display"] != args.display]
            config["monitors"].append({"display": args.display, "name": args.name,
                                       "min": args.minimum, "max": args.maximum})
            config["monitors"].sort(key=lambda item: item["display"])
            save(config)
            print(f"Saved per-monitor range for {args.name}.")
        elif args.monitor_command == "remove":
            config["monitors"] = [m for m in config["monitors"] if m["display"] != args.display]
            save(config)
        else:
            print(json.dumps(config["monitors"], indent=2))
        return
    if args.command == "status":
        print(json.dumps({"automatic": config["automatic"], "profile": config["profile"],
                          "relative_target": scheduled_target(config),
                          "manual_override": config.get("manual_override"),
                          "monitors": config["monitors"]}, indent=2))
        return
    if args.command == "automatic":
        config["automatic"] = args.mode == "on"
        config.pop("manual_override", None)
        save(config)
        print(f"Automatic schedule {'enabled' if config['automatic'] else 'disabled'}.")
    elif args.command == "profile":
        config["profile"] = args.name
        config["automatic"] = True
        config.pop("manual_override", None)
        save(config)
        print(f"Profile set to {args.name}; schedule enabled.")
    elif args.command == "brightness":
        if not 1 <= args.minutes <= 1440:
            parser.error("--minutes must be between 1 and 1440")
        config["manual_override"] = {"brightness": args.relative,
                                     "until": time.time() + args.minutes * 60}
        save(config)
        apply(config, args.relative)
    elif args.command == "resume":
        config.pop("manual_override", None)
        save(config)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(f"daylight-ddc: {error}", file=sys.stderr)
        sys.exit(1)

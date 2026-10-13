# Daylight DDC

Daylight DDC schedules external monitor brightness through DDC/CI. The Linux service works independently of GNOME, and an initial Intel macOS version is available in `macos/`.

## Features

- Smooth, time-based brightness transitions, with faster catch-up after large differences and small steps near the scheduled target.
- Natural and Curtains profiles, with optional approximate location for local sunrise and sunset calculations.
- Optional local weather information, including solar radiation, cloud cover, and precipitation from Open-Meteo.
- An experimental Apple-like brightness profile. It adjusts brightness by time only; it does not sense ambient light or change color temperature like Apple True Tone.
- A Custom profile, manual brightness override, monitor selection, and a command-line interface.
- Location coordinates are kept in memory, rounded to approximately 10 km, and never written to disk by Daylight DDC.

## Requirements

- Linux with `ddcutil`, Python 3, PyGObject/Gio, a session D-Bus, and user-level systemd.
- DDC/CI enabled in the monitor's on-screen menu and accessible to the current user without running the service as root.
- Optional GNOME controls: GNOME Shell 45–50 and libadwaita.
- Optional KDE controls: KDE Plasma 6, the Plasma5Support QML plugin, and Python PyGObject.
- Optional location and weather features: a GNOME location portal, user consent, network access, and Open-Meteo availability.

On Fedora/Nobara, install `ddcutil` and `python3-gobject`. Package names may differ on other distributions. Before installing, confirm the monitor is visible and readable:

```sh
ddcutil detect --brief
ddcutil getvcp 10 --brief
```

Check your distribution's guidance for access to `/dev/i2c-*` if these commands fail. Do not run the service as root.

## Install

### macOS (Intel)

The first macOS version targets Intel Macs and external DDC/CI monitors. Install Homebrew's `ddcctl`, then install DaylightDDC from the repository:

```sh
brew install ddcctl
ddcctl
git clone https://github.com/eduardoruisjbv/DaylightDDC.git
cd DaylightDDC
bash macos/install.sh
```

The installer registers a per-user LaunchAgent and leaves automatic changes disabled. Add each connected monitor with its own comfortable low and high DDC values. Determine those endpoints on that display's OSD; they do not need to match another display:

```sh
daylight-ddc monitor add 1 "Desk AOC" --min 8 --max 62
daylight-ddc monitor add 2 "Side display" --min 16 --max 78
daylight-ddc monitor list
daylight-ddc brightness 3 --minutes 60
daylight-ddc resume
daylight-ddc profile natural
```

The shared control is a **relative position** from 0 to 100 within each monitor's configured range. For example, relative 3 maps to DDC 10 for the first example and DDC 18 for the second. This per-monitor endpoint calibration avoids assuming the same DDC percentage looks equally bright on different panels; DDC values still are not luminance measurements. Monitor numbers follow `ddcctl` and can change when displays are connected differently. `daylight-ddc brightness 3 --minutes 60` holds that relative position for one hour; `resume` returns to the schedule. `daylight-ddc status` reports configured ranges and the schedule target, not a live hardware reading.

The macOS version uses the same Natural, Curtains, Apple-like (experimental), and Custom time curves. Location/weather integration and a graphical menu are not part of this initial macOS installer. `launchd` starts the scheduler at login; `daylight-ddc automatic on|off` controls whether it changes brightness.

### Linux

```sh
git clone https://github.com/eduardoruisjbv/DaylightDDC.git
cd DaylightDDC
python3 install.py --start
```

To skip installing GNOME controls:

```sh
python3 install.py --start --without-extension
```

The installer does not install system packages or enable desktop widgets automatically. It installs GNOME and KDE controls by default; use `--without-extension` to skip GNOME and `--without-plasma` to skip KDE. On first install, automatic scheduling is disabled; no brightness changes occur until you enable it or request a manual adjustment. Existing configuration is preserved during reinstalls.

To enable the user service at login later:

```sh
systemctl --user enable --now daylight-ddc.service
```

On GNOME, log out and back in so Shell discovers the newly installed extension, then enable it and open its preferences:

```sh
gnome-extensions enable daylight-ddc@local
gnome-extensions prefs daylight-ddc@local
```

On KDE Plasma 6, install the package with `python3 install.py --start`, then add **Daylight DDC** from the panel's **Add Widgets** menu. If Plasma does not list it immediately, log out and back in. The widget shows monitor/service status and provides profile selection, automatic scheduling, a one-hour manual brightness slider, **Retomar automático**, and **Redetectar**. Its service and brightness schedule continue independently when the popup closes.

## Profiles

All profiles run in the main service. The GNOME extension is a controller and status view; disabling it does not stop the service.

- **Natural** follows a smooth daylight curve from 0% at sunrise to 100% at solar noon and back to 0% at sunset. With location permission, it uses local sunrise and sunset; without solar data, it approximates them as 06:00, 12:00, and 18:00 local time. Weather details are shown separately and do not lower the 100% solar peak.
- **Curtains** assumes a dark indoor environment and uses a lower brightness curve. Location can shift the curve with local sunrise and sunset, while keeping its dark-room intent.
- **Apple-like (experimental)** provides a time-based brightness approximation only. It does not read ambient light or alter display color temperature.
- **Custom** uses the brightness curve you configure.

The fallback Natural reference points are 0% at 06:00, 100% at 12:00, and 0% at 18:00. The default Curtains curve is 12% at 04:30, 40% from 06:00 through 18:00, 35% at 20:00, and 28% at 22:00. DDC percentages are not luminance measurements and vary by monitor.

## Location and weather

Natural and Curtains can use approximate location to improve local daylight timing. Enable location in GNOME preferences and approve the GNOME location portal request. The CLI can record your choice, but the active GNOME extension is needed to present the portal request:

```sh
daylight-ddc location on
daylight-ddc location off
```

The portal requests city-level precision. Coordinates are rounded to approximately 10 km, retained in memory only, and sent to Open-Meteo for sunrise/sunset and weather data. Weather is refreshed about every 30 minutes. Disabling location ends the location session. If permission is denied or data is unavailable, the configured base curves remain in use.

Open-Meteo data is provided under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its free API endpoint is for non-commercial use; review [Open-Meteo's terms](https://open-meteo.com/en/terms) before deployment or commercial use.

## Command line

The installer places `daylight-ddc` in `~/.local/bin`. Add that directory to `PATH`, or invoke the binary by its full path.

```sh
daylight-ddc status
daylight-ddc profile natural
daylight-ddc profile curtains
daylight-ddc profile apple_like
daylight-ddc profile custom
daylight-ddc automatic on
daylight-ddc automatic off
daylight-ddc brightness 41 --minutes 60
daylight-ddc resume
daylight-ddc rescan
daylight-ddc configure data/config.example.json
```

Selecting a profile also enables scheduling. A manual brightness override lasts for the requested time and then returns to the schedule. `resume` cancels an override and resumes scheduling only if scheduling is enabled. Turning scheduling off preserves the current brightness.

## Configuration

The example configuration is in [`data/config.example.json`](data/config.example.json). The active configuration is saved atomically at `~/.config/daylight-ddc/config.json` (or `$XDG_CONFIG_HOME`). Use the CLI to apply configuration changes; do not edit the active file while the service is running. Schedules require 2–24 distinct time points per profile. `excluded_monitors` accepts monitor identifiers shown by `daylight-ddc status`.

Older configuration files are migrated when saved; their existing schedule is retained as the Custom profile.

## Architecture

- `service/daylight-ddc.py` contains the user service, scheduling logic, DDC operations, D-Bus API, and CLI.
- `extension/` contains the GNOME panel control, preferences, D-Bus client, and location portal flow.
- `plasma/` contains the KDE Plasma 6 panel widget and its small D-Bus bridge; it controls the same Linux service.
- `macos/` contains the Intel macOS `ddcctl` client and a per-user LaunchAgent installer. The shared relative target maps through each configured display's own low/high DDC endpoints.
- The service serializes `ddcutil` operations on a worker thread, uses a 30-second scheduling cycle, and rescans monitors every 120 seconds.
- The session D-Bus name is `io.github.daylightddc.Service` at `/io/github/daylightddc/Service`. `GetState` returns JSON; `StateChanged` publishes state updates. Other desktops can use the CLI or implement a D-Bus client.

## Troubleshooting and limitations

```sh
systemctl --user status daylight-ddc.service
journalctl --user -u daylight-ddc.service
daylight-ddc status
```

DDC/CI support depends on the monitor, cable, GPU, and adapters. One AOC monitor has been confirmed to respond to DDC reads and writes; that does not establish compatibility with other hardware, docks, or suspend/reconnect scenarios. GNOME extension compatibility is declared for versions 45–50 but still requires validation on each Shell version. Solar and weather adjustments depend on portal consent, network connectivity, and Open-Meteo availability. On failure, the service falls back to configured curves. The service keeps the last applied brightness when it exits.

Brightness guidance is a starting point, not a universal ergonomic prescription. Adjust the curve for comfortable reading and to reduce glare, reflections, and strong contrast. See [OSHA's computer workstation environment guidance](https://www.osha.gov/etools/computer-workstations/workstation-environment).

## References

- [DDCutil detect](https://www.ddcutil.com/command_detect/)
- [DDCutil getvcp](https://www.ddcutil.com/command_getvcp/)
- [DDCutil setvcp](https://www.ddcutil.com/command_setvcp/)
- [GNOME Shell extension development guide](https://gjs.guide/extensions/development/preferences.html)

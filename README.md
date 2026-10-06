# Daylight DDC

Daylight DDC is a Linux service for scheduling external monitor brightness through DDC/CI. Its background service works independently of GNOME; the GNOME Shell extension provides controls and preferences.

## Features

- Smooth, time-based brightness transitions, with a gradual adjustment of about 1% of the monitor's reported range per 30-second cycle.
- Natural and Curtains profiles, with optional approximate location for local sunrise and sunset calculations.
- Optional weather-aware refinement for Natural using current solar radiation, cloud cover, and precipitation data from Open-Meteo.
- An experimental Apple-like brightness profile. It adjusts brightness by time only; it does not sense ambient light or change color temperature like Apple True Tone.
- A Custom profile, manual brightness override, monitor selection, and a command-line interface.
- Location coordinates are kept in memory, rounded to approximately 10 km, and never written to disk by Daylight DDC.

## Requirements

- Linux with `ddcutil`, Python 3, PyGObject/Gio, a session D-Bus, and user-level systemd.
- DDC/CI enabled in the monitor's on-screen menu and accessible to the current user without running the service as root.
- Optional GNOME controls: GNOME Shell 45–50 and libadwaita.
- Optional location and weather features: a GNOME location portal, user consent, network access, and Open-Meteo availability.

On Fedora/Nobara, install `ddcutil` and `python3-gobject`. Package names may differ on other distributions. Before installing, confirm the monitor is visible and readable:

```sh
ddcutil detect --brief
ddcutil getvcp 10 --brief
```

Check your distribution's guidance for access to `/dev/i2c-*` if these commands fail. Do not run the service as root.

## Install

```sh
git clone https://github.com/eduardoruisjbv/DaylightDDC.git
cd DaylightDDC
python3 install.py --start
```

For a desktop without GNOME, install only the service:

```sh
python3 install.py --start --without-extension
```

The installer does not install system packages or enable the GNOME extension automatically. On first install, automatic scheduling is disabled; no brightness changes occur until you enable it or request a manual adjustment. Existing configuration is preserved during reinstalls.

To enable the user service at login later:

```sh
systemctl --user enable --now daylight-ddc.service
```

On GNOME, log out and back in so Shell discovers the newly installed extension, then enable it and open its preferences:

```sh
gnome-extensions enable daylight-ddc@local
gnome-extensions prefs daylight-ddc@local
```

## Profiles

All profiles run in the main service. The GNOME extension is a controller and status view; disabling it does not stop the service.

- **Natural** follows a daylight-shaped brightness schedule. With location permission, local sunrise and sunset adjust the schedule; current solar radiation gently refines it using weather data. Without location or network access, it uses the configured base curve.
- **Curtains** assumes a dark indoor environment and uses a lower brightness curve. Location can shift the curve with local sunrise and sunset, while keeping its dark-room intent.
- **Apple-like (experimental)** provides a time-based brightness approximation only. It does not read ambient light or alter display color temperature.
- **Custom** uses the brightness curve you configure.

Schedules interpolate between configured points. The default Natural curve is 12% at 04:30 and 84% from 06:00 through 18:54. The default Curtains curve is 12% at 04:30, 40% from 06:00 through 18:00, 35% at 20:00, and 28% at 22:00. Configure curves to suit your display and environment: DDC percentages are not luminance measurements and vary by monitor.

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

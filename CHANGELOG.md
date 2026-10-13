# Changelog

All notable project changes are documented here.

## Unreleased

## 0.2.0 — 2026-10-13

- Add KDE Plasma 6 controls for profile selection, brightness, and automatic mode.
- Add Intel macOS support with a `ddcctl`-based service, installer, and LaunchAgent.
- Add individually calibrated low/high DDC endpoints for relative brightness.
- Fix Natural brightness scheduling and use the native GNOME Quick Settings slider.
- Improve the Linux installer and update the shipped Nobara configuration and translations.

### Known limitations

- Hardware support varies; DDC/CI access has been confirmed on one AOC monitor only.
- KDE Plasma and macOS support need validation on additional hardware and systems.
- GNOME extension compatibility is declared for versions 45–50 and needs validation per Shell version.
- Location and weather features require GNOME portal consent, network access, and Open-Meteo availability.

## 0.1.0 — 2026-10-06

Initial public release.

- Add a desktop-independent, user-level Linux service for scheduled DDC/CI monitor brightness.
- Add Natural, Curtains, Custom, and experimental Apple-like profiles, with gradual scheduled transitions and a CLI.
- Add a GNOME Shell extension for profile selection, brightness control, monitor status, and preferences.
- Add optional GNOME location permission for approximate local sunrise and sunset calculations in Natural and Curtains.
- Add optional Open-Meteo weather data to refine Natural brightness; keep location coordinates in memory only.
- Include an installer, example configuration, troubleshooting guidance, architecture notes, and external references.

### Known limitations

- Hardware support varies; DDC/CI access has been confirmed on one AOC monitor only.
- GNOME extension compatibility is declared for versions 45–50 and needs validation per Shell version.
- Location and weather features require GNOME portal consent, network access, and Open-Meteo availability.
- Apple-like is experimental and adjusts brightness by time only; it does not sense ambient light or change color temperature.

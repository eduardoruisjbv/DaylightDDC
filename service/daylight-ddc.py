#!/usr/bin/env python3
"""Desktop-independent DDC/CI scheduler and session D-Bus API."""
import argparse
import copy
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

NAME = 'io.github.daylightddc.Service'
OBJECT = '/io/github/daylightddc/Service'
CONFIG = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'daylight-ddc/config.json'
PROFILE_SCHEDULES = {
    # Starting points only: monitor brightness percentages are not calibrated
    # luminance, so users should tune them for their display and room.
    'natural': [
        {'time': '04:30', 'brightness': 12}, {'time': '06:00', 'brightness': 84},
        {'time': '18:54', 'brightness': 84}],
    'curtains': [
        {'time': '04:30', 'brightness': 12}, {'time': '06:00', 'brightness': 40},
        {'time': '18:00', 'brightness': 40}, {'time': '20:00', 'brightness': 35},
        {'time': '22:00', 'brightness': 28}],
    'apple_like': [
        {'time': '06:00', 'brightness': 28}, {'time': '09:00', 'brightness': 44},
        {'time': '12:00', 'brightness': 54}, {'time': '16:00', 'brightness': 53},
        {'time': '19:00', 'brightness': 45}, {'time': '22:00', 'brightness': 35},
        {'time': '00:00', 'brightness': 29}],
    'custom': [
        {'time': '06:00', 'brightness': 26}, {'time': '08:00', 'brightness': 38},
        {'time': '10:00', 'brightness': 50}, {'time': '12:00', 'brightness': 55},
        {'time': '17:00', 'brightness': 52}, {'time': '19:00', 'brightness': 44},
        {'time': '22:00', 'brightness': 34}, {'time': '00:00', 'brightness': 28}],
}
PROFILE_INFO = {
    'natural': {'name': 'Natural', 'description': '84% no pico diurno e 12% à noite; com localização autorizada, acompanha nascer/pôr do sol e reduz suavemente em baixa radiação.'},
    'curtains': {'name': 'Cortinas fechadas', 'description': 'Assume ambiente escuro: pico de 40% durante o dia, 35% e 28% à noite, mínimo de 12%; localização ajusta nascer/pôr do sol.'},
    'apple_like': {'name': 'Apple-like (experimental)', 'description': 'Aproximação experimental por brilho e horário; não usa sensor ambiente nem muda a temperatura de cor.'},
    'custom': {'name': 'Personalizado', 'description': 'Sua própria curva horária.'},
}
DEFAULT = {'automatic': False, 'profile': 'natural',
    'schedule': copy.deepcopy(PROFILE_SCHEDULES['natural']),
    'profile_schedules': copy.deepcopy(PROFILE_SCHEDULES), 'excluded_monitors': [],
    'location_enabled': False}
XML = '''<node><interface name="io.github.daylightddc.Service">
<method name="GetState"><arg type="s" direction="out"/></method>
<method name="SetConfig"><arg type="s" direction="in"/></method>
<method name="SetAutomatic"><arg type="b" direction="in"/></method>
<method name="SetProfile"><arg type="s" direction="in"/></method>
<method name="SetBrightness"><arg type="i" direction="in"/><arg type="u" direction="in"/></method>
<method name="SetLocationEnabled"><arg type="b" direction="in"/></method>
<method name="SetLocation"><arg type="d" direction="in"/><arg type="d" direction="in"/></method>
<method name="SetLocationError"><arg type="s" direction="in"/></method>
<method name="ClearLocation"/>
<method name="Resume"/><method name="Rescan"/>
<signal name="StateChanged"><arg type="s"/></signal>
</interface></node>'''


def minute(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value):
        raise ValueError('Horário deve ter formato HH:MM (00:00–23:59).')
    h, m = map(int, value.split(':'))
    return h * 60 + m


def validate(value):
    legacy = {'automatic', 'schedule', 'excluded_monitors'}
    current = set(DEFAULT)
    previous = current - {'location_enabled'}
    if not isinstance(value, dict) or set(value) not in (legacy, previous, current):
        raise ValueError('Configuração inválida; confira automatic, schedule, excluded_monitors, profile_schedules e location_enabled.')
    if not isinstance(value['automatic'], bool):
        raise ValueError('automatic deve ser booleano.')
    profile = value.get('profile', 'natural')
    if profile not in PROFILE_SCHEDULES:
        raise ValueError('Perfil de brilho desconhecido.')
    schedules = copy.deepcopy(PROFILE_SCHEDULES)
    if 'profile_schedules' in value:
        supplied = value['profile_schedules']
        if not isinstance(supplied, dict) or set(supplied) != set(PROFILE_SCHEDULES):
            raise ValueError('profile_schedules deve definir todos os perfis disponíveis.')
        schedules = {name: validate_schedule(points) for name, points in supplied.items()}
    elif set(value) == legacy:
        # Keep the existing curve under its honest label instead of calling it Natural.
        schedules['custom'] = validate_schedule(value['schedule'])
        profile = 'custom'
    schedule = validate_schedule(value['schedule'])
    schedules[profile] = schedule
    if not isinstance(value['excluded_monitors'], list) or not all(
            isinstance(x, str) for x in value['excluded_monitors']):
        raise ValueError('excluded_monitors deve ser uma lista de identificadores.')
    if 'location_enabled' in value and not isinstance(value['location_enabled'], bool):
        raise ValueError('location_enabled deve ser booleano.')
    return {'automatic': value['automatic'], 'profile': profile, 'schedule': schedule,
            'profile_schedules': schedules,
            'excluded_monitors': copy.deepcopy(value['excluded_monitors']),
            'location_enabled': value.get('location_enabled', False)}


def validate_schedule(points):
    if not isinstance(points, list) or not 2 <= len(points) <= 24:
        raise ValueError('Use de 2 a 24 pontos na programação.')
    times = []
    for point in points:
        if not isinstance(point, dict) or set(point) != {'time', 'brightness'}:
            raise ValueError('Cada ponto deve conter time e brightness.')
        times.append(minute(point['time']))
        level = point['brightness']
        if type(level) is not int or not 0 <= level <= 100:
            raise ValueError('Brilho deve ser um inteiro entre 0 e 100.')
    if len(set(times)) != len(times):
        raise ValueError('Horários não podem se repetir.')
    return copy.deepcopy(points)


def target(schedule, now):
    points = sorted((minute(p['time']), p['brightness']) for p in schedule)
    current = now.hour * 60 + now.minute + now.second / 60
    extended = [(points[-1][0] - 1440, points[-1][1])] + points + [(points[0][0] + 1440, points[0][1])]
    for (a, av), (b, bv) in zip(extended, extended[1:]):
        if a <= current < b:
            return round(av + (bv - av) * (current - a) / (b - a))
    raise ValueError('Programação inválida.')


def solar_schedule(profile, weather, base_schedule):
    """Use local sunrise/sunset from the weather response while preserving profile peaks."""
    if profile not in ('natural', 'curtains') or not weather:
        return None
    try:
        zone = ZoneInfo(weather['timezone'])
        sunrise = [dt.datetime.fromisoformat(x).astimezone(zone) for x in weather['sunrise']]
        sunset = dt.datetime.fromisoformat(weather['sunset'][0]).astimezone(zone)
        low_today = sunrise[0] - dt.timedelta(minutes=90)
        low_tomorrow = sunrise[1] - dt.timedelta(minutes=90)
        floor = min(point['brightness'] for point in base_schedule)
        peak = max(point['brightness'] for point in base_schedule)
        points = [(low_today, floor), (sunrise[0], peak), (sunset, peak)]
        if profile == 'curtains':
            midpoints = sorted({point['brightness'] for point in base_schedule
                                if floor < point['brightness'] < peak}, reverse=True)
            for index, level in enumerate(midpoints, 1):
                points.append((sunset + dt.timedelta(hours=2 * index), level))
        points.append((low_tomorrow, floor))
        compact = {}
        for event, level in points:
            compact[event.strftime('%H:%M')] = level
        return [{'time': clock, 'brightness': level} for clock, level in compact.items()]
    except (KeyError, ValueError, TypeError):
        return None


def fetch_weather(latitude, longitude):
    params = urllib.parse.urlencode({
        'latitude': latitude, 'longitude': longitude,
        'current': 'cloud_cover,precipitation,rain,showers,snowfall,shortwave_radiation',
        'daily': 'sunrise,sunset', 'forecast_days': 2, 'timezone': 'auto'})
    request = urllib.request.Request(
        f'https://api.open-meteo.com/v1/forecast?{params}',
        headers={'User-Agent': 'DaylightDDC/1.0 (weather brightness profiles)'})
    with urllib.request.urlopen(request, timeout=12) as response:
        data = json.loads(response.read(512 * 1024))
    current = data['current']
    daily = data['daily']
    return {'timezone': data['timezone'], 'time': current['time'],
            'cloud_cover': float(current.get('cloud_cover') or 0),
            'precipitation': float(current.get('precipitation') or 0),
            'rain': float(current.get('rain') or 0),
            'showers': float(current.get('showers') or 0),
            'snowfall': float(current.get('snowfall') or 0),
            'shortwave_radiation': float(current.get('shortwave_radiation') or 0),
            'sunrise': daily['sunrise'], 'sunset': daily['sunset'],
            'updated': int(time.time())}


def save(config):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    temp = CONFIG.with_suffix('.tmp')
    temp.write_text(json.dumps(config, indent=2) + '\n')
    temp.chmod(0o600)
    temp.replace(CONFIG)


def ddc(*args):
    result = subprocess.run(['ddcutil', *map(str, args)], capture_output=True,
                            text=True, timeout=20, env={**os.environ, 'LC_ALL': 'C'})
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip()[:600] or 'ddcutil falhou.')
    return result.stdout


def detect():
    output = ddc('detect', '--brief')
    monitors = []
    for block in re.split(r'(?m)^Display\s+\d+', output)[1:]:
        bus = re.search(r'I2C bus:\s*/dev/i2c-(\d+)', block)
        identity = re.search(r'Monitor:\s*(.+)', block)
        if bus and identity:
            monitors.append({'bus': int(bus[1]), 'id': identity[1].strip(), 'error': ''})
    return monitors


class Service:
    def __init__(self):
        self.error = ''
        try:
            self.config = validate(json.loads(CONFIG.read_text())) if CONFIG.exists() else copy.deepcopy(DEFAULT)
        except (OSError, ValueError, TypeError) as exc:
            self.config = copy.deepcopy(DEFAULT)
            self.error = f'Configuração ignorada: {exc}'
        self.monitors = []
        self.connection = None
        self.busy = False
        self.scan_due = 0
        self.override = None
        self.override_until = 0
        self.location = None
        self.location_error = ''
        self.weather = None
        self.weather_error = ''
        self.weather_busy = False
        self.weather_due = 0
        self.generation = 0
        self.loop = GLib.MainLoop()

    def scheduled_target(self):
        profile = self.config['profile']
        schedule = solar_schedule(profile, self.weather, self.config['schedule']) or self.config['schedule']
        try:
            now = dt.datetime.now(ZoneInfo(self.weather['timezone'])) if self.weather else dt.datetime.now()
        except (KeyError, ValueError):
            now = dt.datetime.now()
        value = target(schedule, now)
        if profile == 'natural' and self.weather:
            # Weather radiation follows the daily daylight bell. Keep a gentle
            # 85% floor so clouds/rain refine the curve without darkening it abruptly.
            radiation = max(0.0, min(1.0, self.weather['shortwave_radiation'] / 800.0))
            floor = min(point['brightness'] for point in self.config['schedule'])
            value = round(floor + (value - floor) * (0.85 + 0.15 * radiation))
        return max(0, min(100, value))

    def state(self):
        if not self.config['location_enabled']:
            location_status = 'desativada'
        elif self.config['profile'] not in ('natural', 'curtains'):
            location_status = 'perfil_sem_geolocalizacao'
        elif not self.location:
            location_status = 'erro_permissao' if self.location_error else 'aguardando_permissao'
        elif self.weather:
            location_status = 'ativa'
        else:
            location_status = 'consultando_clima' if not self.weather_error else 'clima_indisponivel'
        weather_state = None if not self.weather else {
            'cloud_cover': self.weather['cloud_cover'],
            'precipitation': self.weather['precipitation'],
            'rain': self.weather['rain'], 'showers': self.weather['showers'],
            'snowfall': self.weather['snowfall'],
            'shortwave_radiation': self.weather['shortwave_radiation'],
            'updated': self.weather['updated'], 'timezone': self.weather['timezone']}
        return json.dumps({'config': self.config, 'monitors': self.monitors,
                           'scheduled_brightness': self.scheduled_target(),
                           'location_status': location_status, 'weather': weather_state,
                           'weather_error': self.weather_error, 'location_error': self.location_error,
                           'available_profiles': PROFILE_INFO,
                           'override_brightness': self.override,
                           'override_until': self.override_until,
                           'busy': self.busy, 'error': self.error}, ensure_ascii=False)

    def changed(self):
        if self.connection:
            self.connection.emit_signal(None, OBJECT, NAME, 'StateChanged', GLib.Variant('(s)', (self.state(),)))

    def acquired(self, connection, _name):
        self.connection = connection
        info = Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0]
        connection.register_object(OBJECT, info, self.method, None, None)
        self.tick()

    def method(self, _connection, _sender, _path, _interface, name, params, invocation):
        try:
            values = params.unpack()
            if name == 'GetState':
                invocation.return_value(GLib.Variant('(s)', (self.state(),)))
                return
            if name == 'SetConfig':
                new_config = validate(json.loads(values[0]))
                save(new_config)
                self.config = new_config
                self.override = None
            elif name == 'SetAutomatic':
                new_config = {**self.config, 'automatic': values[0]}
                save(new_config)
                self.config = new_config
                self.override = None
            elif name == 'SetProfile':
                profile = values[0]
                if profile not in PROFILE_SCHEDULES:
                    raise ValueError('Perfil de brilho desconhecido.')
                new_config = copy.deepcopy(self.config)
                new_config['profile'] = profile
                new_config['schedule'] = copy.deepcopy(new_config['profile_schedules'][profile])
                new_config['automatic'] = True
                new_config = validate(new_config)
                save(new_config)
                self.config = new_config
                self.override = None
            elif name == 'SetBrightness':
                level, seconds = values
                if not 0 <= level <= 100 or not 1 <= seconds <= 86400:
                    raise ValueError('Brilho: 0–100; duração: 1–86400 segundos.')
                self.override = level
                self.override_until = time.time() + seconds
            elif name == 'SetLocationEnabled':
                enabled, = values
                new_config = {**self.config, 'location_enabled': enabled}
                save(new_config)
                self.config = new_config
                self.location = None
                self.location_error = ''
                self.weather = None
                self.weather_error = ''
                self.weather_due = 0
            elif name == 'SetLocation':
                latitude, longitude = values
                if not self.config['location_enabled']:
                    raise ValueError('Ative primeiro o uso de localização nas Preferências GNOME.')
                if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                    raise ValueError('Coordenadas de localização inválidas.')
                # GeoClue/portal requests city precision. Round to about 10 km
                # before keeping it in memory or sending the point to the provider.
                rounded = (round(latitude, 1), round(longitude, 1))
                if self.location == rounded:
                    invocation.return_value(None)
                    return
                self.location = rounded
                self.weather_error = ''
                self.location_error = ''
                self.weather_due = 0
                self.refresh_weather()
            elif name == 'SetLocationError':
                self.location_error = values[0][:300]
                self.location = None
                self.weather = None
                self.weather_due = 0
            elif name == 'ClearLocation':
                self.location = None
                self.location_error = ''
                self.weather = None
                self.weather_error = ''
                self.weather_due = 0
            elif name == 'Resume':
                self.override = None
            elif name == 'Rescan':
                self.scan_due = 0
            else:
                raise ValueError('Método desconhecido.')
            self.generation += 1
            self.changed()
            self.tick()
            invocation.return_value(None)
        except (ValueError, OSError, TypeError) as exc:
            invocation.return_dbus_error(NAME + '.InvalidRequest', str(exc))

    def refresh_weather(self):
        if (not self.config['location_enabled'] or not self.location or
                self.weather_busy or time.monotonic() < self.weather_due):
            return
        self.weather_busy = True
        threading.Thread(target=self.fetch_weather_worker, args=self.location, daemon=True).start()

    def fetch_weather_worker(self, latitude, longitude):
        try:
            value = fetch_weather(latitude, longitude)
            error = ''
        except (OSError, ValueError, KeyError, TimeoutError) as exc:
            value = None
            error = str(exc)[:300] or 'Não foi possível consultar o clima.'
        GLib.idle_add(self.weather_finished, latitude, longitude, value, error)

    def weather_finished(self, latitude, longitude, value, error):
        self.weather_busy = False
        if (not self.config['location_enabled'] or
                self.location != (latitude, longitude)):
            self.weather_due = 0
            self.refresh_weather()
            return GLib.SOURCE_REMOVE
        self.weather_due = time.monotonic() + 1800
        if value:
            self.weather = value
            self.weather_error = ''
        else:
            self.weather_error = error
        self.generation += 1
        self.changed()
        self.tick()
        return GLib.SOURCE_REMOVE

    def tick(self):
        if self.override is not None and time.time() >= self.override_until:
            self.override = None
            self.generation += 1
            self.changed()
        if self.busy or not self.connection:
            return GLib.SOURCE_CONTINUE
        self.refresh_weather()
        desired = self.override
        if desired is None and self.config['automatic']:
            desired = self.scheduled_target()
        scan = time.monotonic() >= self.scan_due
        # One worker serializes every DDC request; GLib/D-Bus never block on I2C.
        self.busy = True
        generation = self.generation
        excluded = list(self.config['excluded_monitors'])
        monitors = copy.deepcopy(self.monitors)
        gradual = self.override is None and self.config['automatic']
        threading.Thread(target=self.work, args=(generation, scan, desired, excluded, monitors, gradual), daemon=True).start()
        return GLib.SOURCE_CONTINUE

    def work(self, generation, scan, desired, excluded, monitors, gradual):
        error = ''
        try:
            if scan:
                monitors = detect()
            for monitor in monitors:
                if monitor['id'] in excluded:
                    monitor['excluded'] = True
                    continue
                monitor['excluded'] = False
                try:
                    # Re-read periodically, including after wake/reconnect and physical OSD changes.
                    if scan or 'maximum' not in monitor or monitor.get('error'):
                        result = ddc('--bus', monitor['bus'], 'getvcp', '10', '--brief')
                        match = re.search(r'VCP 10 C (\d+) (\d+)', result)
                        if not match or int(match[2]) <= 0:
                            raise RuntimeError('Monitor não informa brilho DDC válido.')
                        monitor['raw'], monitor['maximum'] = int(match[1]), int(match[2])
                    # Skip stale queued writes after pause or a newer manual adjustment.
                    if desired is not None and generation == self.generation:
                        goal = round(desired * monitor['maximum'] / 100)
                        raw = goal
                        if gradual:
                            # At the 30-second scheduler cadence, cap each write
                            # to about 1% of the monitor range to soften startup
                            # and profile changes as well as the timed curve.
                            step = max(1, math.ceil(monitor['maximum'] / 100))
                            raw = monitor['raw'] + max(-step, min(step, goal - monitor['raw']))
                        if raw != monitor['raw']:
                            ddc('--bus', monitor['bus'], 'setvcp', '10', raw)
                            monitor['raw'] = raw
                    monitor['brightness'] = round(monitor['raw'] * 100 / monitor['maximum'])
                    monitor['error'] = ''
                except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
                    monitor['error'] = str(exc)[:600]
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            error = str(exc)[:600]
        GLib.idle_add(self.finished, generation, scan, monitors, error)

    def finished(self, generation, scan, monitors, error):
        self.monitors = monitors
        self.error = error
        self.busy = False
        if scan and generation == self.generation:
            self.scan_due = time.monotonic() + 120
        self.changed()
        if generation != self.generation:
            self.tick()
        return GLib.SOURCE_REMOVE

    def run(self):
        owner = Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE,
                                 self.acquired, None, lambda *_: self.loop.quit())
        GLib.timeout_add_seconds(30, self.tick)
        for sig in (signal.SIGTERM, signal.SIGINT):
            GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, lambda: self.loop.quit() or False)
        try:
            self.loop.run()
        finally:
            Gio.bus_unown_name(owner)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('serve', 'status', 'resume', 'rescan'):
        sub.add_parser(name)
    automatic = sub.add_parser('automatic')
    automatic.add_argument('mode', choices=['on', 'off'])
    profile = sub.add_parser('profile')
    profile.add_argument('name', choices=sorted(PROFILE_SCHEDULES))
    brightness = sub.add_parser('brightness')
    brightness.add_argument('percent', type=int)
    brightness.add_argument('--minutes', type=int, default=60)
    config = sub.add_parser('configure')
    config.add_argument('file', type=Path)
    location = sub.add_parser('location')
    location.add_argument('mode', choices=['on', 'off'])
    args = parser.parse_args()
    if args.command == 'serve':
        Service().run()
        return
    calls = {'status': ('GetState', None), 'resume': ('Resume', None), 'rescan': ('Rescan', None)}
    if args.command == 'automatic':
        method, params = 'SetAutomatic', GLib.Variant('(b)', (args.mode == 'on',))
    elif args.command == 'profile':
        method, params = 'SetProfile', GLib.Variant('(s)', (args.name,))
    elif args.command == 'brightness':
        if not 0 <= args.percent <= 100 or not 1 <= args.minutes <= 1440:
            parser.error('Brilho: 0–100; minutos: 1–1440.')
        method, params = 'SetBrightness', GLib.Variant('(iu)', (args.percent, args.minutes * 60))
    elif args.command == 'configure':
        value = validate(json.loads(args.file.read_text()))
        method, params = 'SetConfig', GLib.Variant('(s)', (json.dumps(value),))
    elif args.command == 'location':
        method, params = 'SetLocationEnabled', GLib.Variant('(b)', (args.mode == 'on',))
    else:
        method, params = calls[args.command]
    try:
        proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE,
                                               None, NAME, OBJECT, NAME, None)
        result = proxy.call_sync(method, params, Gio.DBusCallFlags.NONE, 5000, None)
        if args.command == 'status':
            print(json.dumps(json.loads(result.unpack()[0]), indent=2, ensure_ascii=False))
    except GLib.Error as exc:
        parser.exit(1, f'Daylight DDC: {exc.message}\n')


if __name__ == '__main__':
    main()

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {connect, call} from './client.js';

export default class Preferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage({title: 'Daylight DDC', icon_name: 'display-brightness-symbolic'});
        const statusGroup = new Adw.PreferencesGroup({title: 'Service'});
        const status = new Adw.ActionRow({title: 'Connecting…', subtitle: 'The service keeps running when the extension is disabled.'});
        statusGroup.add(status);
        page.add(statusGroup);
        window.add(page);
        let closed = false;
        window.connect('close-request', () => { closed = true; return false; });
        connect((proxy, error) => {
            if (closed) return;
            if (error) { status.title = error.message; return; }
            call(proxy, 'GetState', [], (result, failure) => {
                if (closed) return;
                if (failure) { status.title = 'Service unavailable'; status.subtitle = failure.message; return; }
                const state = JSON.parse(result[0]);
                status.title = 'Service conectado';
                const profile = state.config.profile || 'natural';
                const profileInfo = state.available_profiles?.[profile];
                status.subtitle = `${profileInfo?.name || 'Natural'} · ${profileInfo?.description || ''}\n` +
                    (state.error || state.monitors.map(m => `${m.id}: ${m.error || `${m.brightness ?? '—'}%`}`).join('\n') || 'No monitors detected');
                const group = new Adw.PreferencesGroup({title: 'Daily schedule',
                    description: 'Uses the local clock; with location permission, follows local solar times.'});
                page.add(group);
                const automatic = new Adw.SwitchRow({title: 'Enable scheduled brightness', active: state.config.automatic});
                group.add(automatic);
                const locationGroup = new Adw.PreferencesGroup({title: 'Location and weather',
                    description: 'Used by Natural and Closed Curtains to calculate sunrise/sunset; Natural also considers solar radiation and clouds.'});
                page.add(locationGroup);
                const locationRow = new Adw.SwitchRow({title: 'Allow approximate location',
                    subtitle: 'Disabled. Profiles continue using the configured schedules.',
                    active: state.config.location_enabled});
                locationGroup.add(locationRow);
                let updatingLocation = false;
                const explainLocation = value => {
                    if (locationRow.active !== value.config.location_enabled) {
                        updatingLocation = true;
                        locationRow.active = value.config.location_enabled;
                        updatingLocation = false;
                    }
                    if (!value.config.location_enabled) {
                        locationRow.subtitle = 'Disabled. Profiles continue using the configured schedules.';
                    } else if (value.location_status === 'active' && value.weather) {
                        const weather = value.weather;
                        const rain = weather.precipitation > 0 ? `precipitation ${weather.precipitation} mm` : 'sem precipitation atual';
                        locationRow.subtitle = `Active · clouds ${weather.cloud_cover}% · ${rain} · updates every 30 min.`;
                    } else if (value.location_status === 'weather_unavailable') {
                        locationRow.subtitle = `Location allowed; weather service unavailable: ${value.weather_error}`;
                    } else if (value.location_status === 'permission_error') {
                        locationRow.subtitle = `${value.location_error || 'Location permission was denied.'} Disable and enable it again to retry.`;
                    } else if (value.location_status === 'profile_without_geolocation') {
                        locationRow.subtitle = 'It will be requested when you select Natural or Closed Curtains.';
                    } else if (value.location_status === 'checking_weather') {
                        locationRow.subtitle = 'Location allowed; checking weather. The brightness schedule remains active meanwhile.';
                    } else {
                        locationRow.subtitle = 'Waiting for GNOME location permission.';
                    }
                };
                explainLocation(state);
                locationRow.connect('notify::active', () => {
                    if (updatingLocation) return;
                    if (!locationRow.active) {
                        call(proxy, 'SetLocationEnabled', [false], (_reply, err) => {
                            status.title = err ? 'Could not remove location' : 'Location removed';
                            if (err) status.subtitle = err.message;
                        });
                        return;
                    }
                    updatingLocation = true;
                    locationRow.active = false;
                    updatingLocation = false;
                    const dialog = new Adw.MessageDialog({transient_for: window,
                        heading: 'Allow weather features using approximate location?',
                        body: 'Sunrise and sunset times will be obtained at city-level accuracy. Your location will be rounded to about 10 km, kept in memory only, and sent to Open-Meteo to retrieve cloud cover, rain, and solar radiation. Queries run every 30 minutes. DaylightDDC does not write coordinates to disk; disabling this feature ends the location session. Data: Open-Meteo, CC BY 4.0; the free endpoint is for non-commercial use.'});
                    dialog.add_response('cancel', 'Cancel');
                    dialog.add_response('allow', 'Continue');
                    dialog.set_response_appearance('allow', Adw.ResponseAppearance.SUGGESTED);
                    dialog.connect('response', (_dialog, response) => {
                        if (response !== 'allow') return;
                        updatingLocation = true;
                        call(proxy, 'SetLocationEnabled', [true], (_reply, err) => {
                            if (closed) return;
                            if (err) {
                                updatingLocation = false;
                                status.title = 'Could not enable location';
                                status.subtitle = err.message;
                                return;
                            }
                            locationRow.active = true;
                            updatingLocation = false;
                            locationRow.subtitle = 'Waiting for GNOME location permission.';
                        });
                    });
                    dialog.present();
                });
                const stateSignal = proxy.connectSignal('StateChanged', (_proxy, _sender, [json]) => {
                    if (!closed) explainLocation(JSON.parse(json));
                });
                window.connect('close-request', () => {
                    proxy.disconnectSignal(stateSignal);
                    return false;
                });
                const rows = [];
                const addPoint = point => {
                    const row = new Adw.ActionRow({title: 'Time and brightness (%)'});
                    const entry = new Gtk.Entry({text: point.time, max_length: 5, width_chars: 5,
                        valign: Gtk.Align.CENTER, placeholder_text: 'HH:MM'});
                    const spin = new Gtk.SpinButton({adjustment: new Gtk.Adjustment({lower: 0, upper: 100,
                        step_increment: 1, page_increment: 5, value: point.brightness}), valign: Gtk.Align.CENTER});
                    const remove = new Gtk.Button({icon_name: 'list-remove-symbolic', valign: Gtk.Align.CENTER,
                        tooltip_text: 'Remove time'});
                    row.add_suffix(entry);
                    row.add_suffix(spin);
                    row.add_suffix(remove);
                    group.add(row);
                    const item = {row, entry, spin};
                    rows.push(item);
                    remove.connect('clicked', () => { group.remove(row); rows.splice(rows.indexOf(item), 1); });
                };
                state.config.schedule.forEach(addPoint);
                const actions = new Adw.ActionRow({title: 'Save to apply schedule'});
                const add = new Gtk.Button({label: 'Add', valign: Gtk.Align.CENTER});
                const save = new Gtk.Button({label: 'Save', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
                actions.add_suffix(add);
                actions.add_suffix(save);
                group.add(actions);
                add.connect('clicked', () => addPoint({time: '12:00', brightness: 50}));
                const monitors = new Adw.PreferencesGroup({title: 'Monitors', description: 'Enabled monitors follow the same schedule and manual control.'});
                page.add(monitors);
                const exclusions = new Set(state.config.excluded_monitors);
                for (const monitor of state.monitors) {
                    const row = new Adw.SwitchRow({title: monitor.id, subtitle: monitor.error || `I²C bus ${monitor.bus}`,
                        active: !exclusions.has(monitor.id)});
                    row.connect('notify::active', () => {
                        if (row.active) exclusions.delete(monitor.id);
                        else exclusions.add(monitor.id);
                    });
                    monitors.add(row);
                }
                save.connect('clicked', () => {
                    save.sensitive = false;
                    const config = {...state.config, automatic: automatic.active,
                        schedule: rows.map(r => ({time: r.entry.text.trim(), brightness: r.spin.get_value_as_int()})),
                        excluded_monitors: [...exclusions]};
                    call(proxy, 'SetConfig', [JSON.stringify(config)], (_reply, err) => {
                        if (closed) return;
                        save.sensitive = true;
                        status.title = err ? 'Could not save' : 'Schedule saved';
                        status.subtitle = err ? err.message : 'Changes are now available in the service.';
                    });
                });
            });
        });
    }
}

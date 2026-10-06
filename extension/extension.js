import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {connect, call} from './client.js';
import {ApproxLocation} from './location.js';

export default class DaylightDDC extends Extension {
    enable() {
        this._alive = true;
        this._updating = false;
        this._button = new PanelMenu.Button(0, 'Daylight DDC');
        this._button.add_child(new St.Icon({icon_name: 'display-brightness-symbolic',
            style_class: 'system-status-icon'}));
        this._status = new PopupMenu.PopupMenuItem('Conectando ao serviço…', {reactive: false});
        this._button.menu.addMenuItem(this._status);
        this._profileMenu = new PopupMenu.PopupSubMenuMenuItem('Perfil de brilho', false);
        this._profileItems = {};
        for (const [id, label] of Object.entries({natural: 'Natural', curtains: 'Cortinas fechadas', apple_like: 'Apple-like (experimental)', custom: 'Personalizado'})) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._send('SetProfile', [id]));
            this._profileMenu.menu.addMenuItem(item);
            this._profileItems[id] = item;
        }
        this._button.menu.addMenuItem(this._profileMenu);
        this._automatic = new PopupMenu.PopupSwitchMenuItem('Brilho por horário', false);
        this._button.menu.addMenuItem(this._automatic);
        this._automatic.connect('toggled', (_item, enabled) => {
            if (!this._updating) this._send('SetAutomatic', [enabled]);
        });
        const row = new PopupMenu.PopupBaseMenuItem({activate: false});
        this._slider = new Slider.Slider(0.5);
        this._slider.accessible_name = 'Brilho dos monitores';
        row.add_child(this._slider);
        this._button.menu.addMenuItem(row);
        this._slider.connect('notify::value', () => {
            if (this._updating) return;
            if (this._debounce) GLib.Source.remove(this._debounce);
            this._debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                this._debounce = 0;
                this._send('SetBrightness', [Math.round(this._slider.value * 100), 3600]);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._button.menu.addAction('Retomar programação', () => this._send('Resume', []));
        this._button.menu.addAction('Detectar monitores', () => this._send('Rescan', []));
        this._button.menu.addAction('Configurar horários…', () => this.openPreferences());
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this._refresh();
        });
        Main.panel.addToStatusArea(this.uuid, this._button);
        this._proxy = connect((proxy, error) => {
            if (!this._alive) return;
            if (error) {
                this._status.label.text = 'Serviço indisponível: instale Daylight DDC';
                return;
            }
            this._signal = proxy.connectSignal('StateChanged', (_p, _sender, [json]) => this._render(json));
            this._refresh();
        });
    }

    _send(method, args) {
        if (!this._proxy) return;
        call(this._proxy, method, args, (_result, error) => {
            if (!this._alive) return;
            if (error) this._status.label.text = `Falha: ${error.message}`;
            else this._refresh();
        });
    }

    _refresh() {
        if (!this._proxy) return;
        call(this._proxy, 'GetState', [], (result, error) => {
            if (!this._alive) return;
            if (error) this._status.label.text = 'Serviço indisponível: instale Daylight DDC';
            else this._render(result[0]);
        });
    }

    _render(json) {
        if (!this._alive) return;
        const state = JSON.parse(json);
        const monitors = state.monitors.filter(m => !m.excluded && !m.error);
        const level = state.override_brightness ?? monitors[0]?.brightness ?? state.scheduled_brightness;
        let text = monitors.length ? `${level}% · ${monitors.length} monitor(es)` : 'Nenhum monitor DDC disponível';
        if (state.override_brightness !== null) text += ' · Manual por 1 hora';
        if (state.error || state.monitors.some(m => m.error)) text = 'Falha DDC · consulte Preferências/Logs';
        const profile = state.config.profile || 'natural';
        this._syncLocation(state);
        if (state.weather && ['natural', 'curtains'].includes(profile)) {
            const rain = state.weather.precipitation > 0 ? ` · chuva ${state.weather.precipitation} mm` : ' · sem chuva';
            text += ` · nuvens ${state.weather.cloud_cover}%${rain}`;
        }
        const info = state.available_profiles?.[profile];
        this._profileMenu.label.text = `Perfil de brilho · ${info?.name || 'Natural'}`;
        for (const [id, item] of Object.entries(this._profileItems))
            item.setOrnament(id === profile ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        this._updating = true;
        this._automatic.setToggleState(state.config.automatic);
        // Keep the thumb under the user's control while their update is pending.
        if (!this._debounce) this._slider.value = level / 100;
        this._updating = false;
        this._status.label.text = text;
    }

    _syncLocation(state) {
        const shouldUse = state.config.location_enabled && ['natural', 'curtains'].includes(state.config.profile);
        if (shouldUse && !this._locationClient) {
            this._locationClient = new ApproxLocation((latitude, longitude) => {
                if (this._alive) this._send('SetLocation', [Math.round(latitude * 10) / 10, Math.round(longitude * 10) / 10]);
            }, error => {
                if (this._alive) {
                    this._status.label.text = error;
                    this._send('SetLocationError', [error]);
                }
            });
            this._locationClient.start();
        } else if (!shouldUse && this._locationClient) {
            this._locationClient.stop();
            this._locationClient = null;
            this._send('ClearLocation', []);
        } else if (shouldUse && state.location_status === 'aguardando_permissao') {
            this._locationClient?.refresh();
        }
    }

    disable() {
        this._alive = false;
        if (this._locationClient) {
            this._locationClient.stop();
            this._locationClient = null;
            this._send('ClearLocation', []);
        }
        if (this._debounce) GLib.Source.remove(this._debounce);
        this._debounce = 0;
        if (this._signal) this._proxy?.disconnectSignal(this._signal);
        this._signal = null;
        this._proxy = null;
        this._button?.destroy();
        this._button = null;
    }
}

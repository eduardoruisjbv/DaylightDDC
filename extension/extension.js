import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {connect, call} from './client.js';
import {ApproxLocation} from './location.js';

const DaylightToggle = GObject.registerClass(
class DaylightToggle extends QuickSettings.QuickMenuToggle {
    _init() {
        super._init({
            title: 'Daylight DDC',
            subtitle: 'Conectando ao serviço…',
            iconName: 'display-brightness-symbolic',
            toggleMode: false,
        });

        this.menu.setHeader('display-brightness-symbolic', 'Daylight DDC');
        this.status = this.menu.addAction('Conectando ao serviço…', () => {});
        this.status.reactive = false;

        this.profileMenu = new PopupMenu.PopupSubMenuMenuItem('Perfil de brilho', false);
        this.profileItems = {};
        for (const [id, label] of Object.entries({
            natural: 'Natural', curtains: 'Cortinas fechadas',
            apple_like: 'Apple-like (experimental)', custom: 'Personalizado',
        })) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this.extension._send('SetProfile', [id]));
            this.profileMenu.menu.addMenuItem(item);
            this.profileItems[id] = item;
        }
        this.menu.addMenuItem(this.profileMenu);

        this.automatic = new PopupMenu.PopupSwitchMenuItem('Brilho por horário', false);
        this.automatic.connect('toggled', (_item, enabled) => {
            if (!this.extension._updating)
                this.extension._send('SetAutomatic', [enabled]);
        });
        this.menu.addMenuItem(this.automatic);

        const row = new PopupMenu.PopupBaseMenuItem({activate: false});
        this.slider = new St.Slider({value: 0.5, x_expand: true});
        this.slider.accessible_name = 'Brilho dos monitores';
        row.add_child(this.slider);
        this.menu.addMenuItem(row);
        this.slider.connect('notify::value', () => {
            const extension = this.extension;
            if (extension._updating)
                return;
            if (extension._debounce)
                GLib.Source.remove(extension._debounce);
            extension._debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                extension._debounce = 0;
                extension._send('SetBrightness', [Math.round(this.slider.value * 100), 3600]);
                return GLib.SOURCE_REMOVE;
            });
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Retomar programação', () => this.extension._send('Resume', []));
        this.menu.addAction('Detectar monitores', () => this.extension._send('Rescan', []));
        this.menu.addAction('Configurar horários…', () => this.extension.openPreferences());
    }

    setState(text, enabled) {
        this.subtitle = text;
        this.status.label.text = text;
        this.set({checked: enabled});
    }
});

export default class DaylightDDC extends Extension {
    enable() {
        this._alive = true;
        this._updating = false;
        this._toggle = new DaylightToggle();
        this._toggle.extension = this;
        this._quickSettings = Main.panel.statusArea.quickSettings;
        this._quickSettings.menu.addItem(this._toggle, 1);
        this._proxy = connect((proxy, error) => {
            if (!this._alive)
                return;
            if (error) {
                this._toggle.setState('Serviço indisponível: instale Daylight DDC', false);
                return;
            }
            this._signal = proxy.connectSignal('StateChanged', (_p, _sender, [json]) => this._render(json));
            this._refresh();
        });
    }

    _send(method, args) {
        if (!this._proxy)
            return;
        call(this._proxy, method, args, (_result, error) => {
            if (!this._alive)
                return;
            if (error)
                this._toggle.status.label.text = `Falha: ${error.message}`;
            else
                this._refresh();
        });
    }

    _refresh() {
        if (!this._proxy)
            return;
        call(this._proxy, 'GetState', [], (result, error) => {
            if (!this._alive)
                return;
            if (error)
                this._toggle.setState('Serviço indisponível: instale Daylight DDC', false);
            else
                this._render(result[0]);
        });
    }

    _render(json) {
        if (!this._alive)
            return;
        const state = JSON.parse(json);
        const monitors = state.monitors.filter(m => !m.excluded && !m.error);
        const level = state.override_brightness ?? monitors[0]?.brightness ?? state.scheduled_brightness;
        let text = monitors.length ? `${level}% · ${monitors.length} monitor(es)` : 'Nenhum monitor DDC disponível';
        if (state.override_brightness !== null)
            text += ' · Manual por 1 hora';
        if (state.error || state.monitors.some(m => m.error))
            text = 'Falha DDC · consulte Preferências/Logs';

        const profile = state.config.profile || 'natural';
        this._syncLocation(state);
        if (state.weather && ['natural', 'curtains'].includes(profile)) {
            const rain = state.weather.precipitation > 0 ? ` · chuva ${state.weather.precipitation} mm` : ' · sem chuva';
            text += ` · nuvens ${state.weather.cloud_cover}%${rain}`;
        }
        const info = state.available_profiles?.[profile];
        this._toggle.profileMenu.label.text = `Perfil de brilho · ${info?.name || 'Natural'}`;
        for (const [id, item] of Object.entries(this._toggle.profileItems))
            item.setOrnament(id === profile ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);

        this._updating = true;
        this._toggle.automatic.setToggleState(state.config.automatic);
        if (!this._debounce)
            this._toggle.slider.value = level / 100;
        this._toggle.setState(text, state.config.automatic);
        this._updating = false;
    }

    _syncLocation(state) {
        const shouldUse = state.config.location_enabled && ['natural', 'curtains'].includes(state.config.profile);
        if (shouldUse && !this._locationClient) {
            this._locationClient = new ApproxLocation((latitude, longitude) => {
                if (this._alive)
                    this._send('SetLocation', [Math.round(latitude * 10) / 10, Math.round(longitude * 10) / 10]);
            }, error => {
                if (this._alive) {
                    this._toggle.status.label.text = error;
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
        if (this._debounce)
            GLib.Source.remove(this._debounce);
        this._debounce = 0;
        if (this._signal)
            this._proxy?.disconnectSignal(this._signal);
        this._signal = null;
        this._proxy = null;
        this._toggle?.destroy();
        this._quickSettings = null;
        this._toggle = null;
    }
}

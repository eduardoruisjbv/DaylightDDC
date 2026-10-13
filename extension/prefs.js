import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {connect, call} from './client.js';

export default class Preferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage({title: 'Daylight DDC', icon_name: 'display-brightness-symbolic'});
        const statusGroup = new Adw.PreferencesGroup({title: 'Serviço'});
        const status = new Adw.ActionRow({title: 'Conectando…', subtitle: 'O serviço continua funcionando ao desativar a extensão.'});
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
                if (failure) { status.title = 'Serviço indisponível'; status.subtitle = failure.message; return; }
                const state = JSON.parse(result[0]);
                status.title = 'Serviço conectado';
                const profile = state.config.profile || 'natural';
                const profileInfo = state.available_profiles?.[profile];
                status.subtitle = `${profileInfo?.name || 'Natural'} · ${profileInfo?.description || ''}\n` +
                    (state.error || state.monitors.map(m => `${m.id}: ${m.error || `${m.brightness ?? '—'}%`}`).join('\n') || 'Nenhum monitor detectado');
                const group = new Adw.PreferencesGroup({title: 'Programação diária',
                    description: 'Usa o relógio local; com localização autorizada, segue os horários solares do local aproximado.'});
                page.add(group);
                const automatic = new Adw.SwitchRow({title: 'Ativar brilho por horário', active: state.config.automatic});
                group.add(automatic);
                const locationGroup = new Adw.PreferencesGroup({title: 'Localização e condições do tempo',
                    description: 'Usado por Natural e Cortinas para calcular nascer/pôr do sol; Natural também considera a radiação solar e nuvens.'});
                page.add(locationGroup);
                const locationRow = new Adw.SwitchRow({title: 'Permitir localização aproximada',
                    subtitle: 'Desativada. Os perfis continuam usando os horários configurados.',
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
                        locationRow.subtitle = 'Desativada. Os perfis continuam usando os horários configurados.';
                    } else if (value.location_status === 'ativa' && value.weather) {
                        const weather = value.weather;
                        const rain = weather.precipitation > 0 ? `precipitação ${weather.precipitation} mm` : 'sem precipitação atual';
                        locationRow.subtitle = `Ativa · nuvens ${weather.cloud_cover}% · ${rain} · atualização a cada 30 min.`;
                    } else if (value.location_status === 'clima_indisponivel') {
                        locationRow.subtitle = `Localização autorizada; serviço de clima indisponível: ${value.weather_error}`;
                    } else if (value.location_status === 'erro_permissao') {
                        locationRow.subtitle = `${value.location_error || 'A permissão de localização foi negada.'} Desative e ative para tentar novamente.`;
                    } else if (value.location_status === 'perfil_sem_geolocalizacao') {
                        locationRow.subtitle = 'Será solicitada ao selecionar Natural ou Cortinas.';
                    } else if (value.location_status === 'consultando_clima') {
                        locationRow.subtitle = 'Localização autorizada; consultando o clima. A curva horária segue ativa enquanto isso.';
                    } else {
                        locationRow.subtitle = 'Aguardando a permissão de localização do GNOME.';
                    }
                };
                explainLocation(state);
                locationRow.connect('notify::active', () => {
                    if (updatingLocation) return;
                    if (!locationRow.active) {
                        call(proxy, 'SetLocationEnabled', [false], (_reply, err) => {
                            status.title = err ? 'Não foi possível remover a localização' : 'Localização removida';
                            if (err) status.subtitle = err.message;
                        });
                        return;
                    }
                    updatingLocation = true;
                    locationRow.active = false;
                    updatingLocation = false;
                    const dialog = new Adw.MessageDialog({transient_for: window,
                        heading: 'Permitir clima por localização aproximada?',
                        body: 'Os horários de nascer e pôr do sol serão obtidos com precisão de cidade. A posição será arredondada para cerca de 10 km, mantida apenas em memória e enviada ao Open-Meteo para consultar nuvens, chuva e radiação solar. As consultas ocorrem a cada 30 minutos. DaylightDDC não grava coordenadas em disco; desligar o recurso encerra a sessão de localização. Dados: Open-Meteo, CC BY 4.0; o endpoint gratuito é para uso não comercial.'});
                    dialog.add_response('cancel', 'Cancelar');
                    dialog.add_response('allow', 'Continuar');
                    dialog.set_response_appearance('allow', Adw.ResponseAppearance.SUGGESTED);
                    dialog.connect('response', (_dialog, response) => {
                        if (response !== 'allow') return;
                        updatingLocation = true;
                        call(proxy, 'SetLocationEnabled', [true], (_reply, err) => {
                            if (closed) return;
                            if (err) {
                                updatingLocation = false;
                                status.title = 'Não foi possível ativar localização';
                                status.subtitle = err.message;
                                return;
                            }
                            locationRow.active = true;
                            updatingLocation = false;
                            locationRow.subtitle = 'Aguardando a permissão de localização do GNOME.';
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
                    const row = new Adw.ActionRow({title: 'Horário e brilho (%)'});
                    const entry = new Gtk.Entry({text: point.time, max_length: 5, width_chars: 5,
                        valign: Gtk.Align.CENTER, placeholder_text: 'HH:MM'});
                    const spin = new Gtk.SpinButton({adjustment: new Gtk.Adjustment({lower: 0, upper: 100,
                        step_increment: 1, page_increment: 5, value: point.brightness}), valign: Gtk.Align.CENTER});
                    const remove = new Gtk.Button({icon_name: 'list-remove-symbolic', valign: Gtk.Align.CENTER,
                        tooltip_text: 'Remover horário'});
                    row.add_suffix(entry);
                    row.add_suffix(spin);
                    row.add_suffix(remove);
                    group.add(row);
                    const item = {row, entry, spin};
                    rows.push(item);
                    remove.connect('clicked', () => { group.remove(row); rows.splice(rows.indexOf(item), 1); });
                };
                state.config.schedule.forEach(addPoint);
                const actions = new Adw.ActionRow({title: 'Salvar para aplicar a programação'});
                const add = new Gtk.Button({label: 'Adicionar', valign: Gtk.Align.CENTER});
                const save = new Gtk.Button({label: 'Salvar', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
                actions.add_suffix(add);
                actions.add_suffix(save);
                group.add(actions);
                add.connect('clicked', () => addPoint({time: '12:00', brightness: 50}));
                const monitors = new Adw.PreferencesGroup({title: 'Monitores', description: 'Os monitores habilitados seguem a mesma programação e controle manual.'});
                page.add(monitors);
                const exclusions = new Set(state.config.excluded_monitors);
                for (const monitor of state.monitors) {
                    const row = new Adw.SwitchRow({title: monitor.id, subtitle: monitor.error || `Barramento I²C ${monitor.bus}`,
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
                        status.title = err ? 'Não foi possível salvar' : 'Programação salva';
                        status.subtitle = err ? err.message : 'As alterações já estão disponíveis no serviço.';
                    });
                });
            });
        });
    }
}

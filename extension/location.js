import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS = 'org.freedesktop.portal.Desktop';
const ROOT = '/org/freedesktop/portal/desktop';
const LOCATION = 'org.freedesktop.portal.Location';
const REQUEST = 'org.freedesktop.portal.Request';
const SESSION = 'org.freedesktop.portal.Session';

// The GNOME Shell extension owns this session, so the desktop location portal
// can present its native consent UI. Only CITY accuracy is requested.
export class ApproxLocation {
    constructor(onLocation, onError) {
        this._onLocation = onLocation;
        this._onError = onError;
        this._session = null;
        this._subscriptions = [];
        this._allowed = false;
        this._last = null;
    }

    start() {
        if (this._session) return;
        const connection = Gio.DBus.session;
        const token = `daylight_${GLib.uuid_string_random().replaceAll('-', '')}`;
        const options = new GLib.Variant('a{sv}', {
            session_handle_token: new GLib.Variant('s', token),
            accuracy: new GLib.Variant('u', 2),
            'time-threshold': new GLib.Variant('u', 1800),
            'distance-threshold': new GLib.Variant('u', 1000),
        });
        try {
            const created = connection.call_sync(BUS, ROOT, LOCATION, 'CreateSession',
                new GLib.Variant('(a{sv})', [options]), new GLib.VariantType('(o)'),
                Gio.DBusCallFlags.NONE, 5000, null);
            this._session = created.deepUnpack()[0];
        } catch (error) {
            this._onError?.(`Location portal unavailable: ${error.message}`);
            return;
        }

        this._subscriptions.push(connection.signal_subscribe(BUS, LOCATION, 'LocationUpdated', ROOT,
            this._session, Gio.DBusSignalFlags.NONE, (_conn, _sender, _path, _iface, _signal, params) => {
                const [, location] = params.deepUnpack();
                const lat = Number(location.Latitude);
                const lon = Number(location.Longitude);
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    this._last = [lat, lon];
                    this._publish();
                }
            }));
        this._subscriptions.push(connection.signal_subscribe(BUS, SESSION, 'Closed', this._session,
            null, Gio.DBusSignalFlags.NONE, () => {
                this._onError?.('Location access was revoked by the system.');
                this.stop();
            }));

        const startToken = `start_${GLib.uuid_string_random().replaceAll('-', '')}`;
        const uniqueName = connection.get_unique_name().slice(1).replaceAll('.', '_');
        const requestPath = `${ROOT}/request/_${uniqueName}/${startToken}`;
        this._subscriptions.push(connection.signal_subscribe(BUS, REQUEST, 'Response', requestPath,
            null, Gio.DBusSignalFlags.NONE, (_conn, _sender, _path, _iface, _signal, params) => {
                const [response] = params.deepUnpack();
                if (response !== 0) {
                    this._onError?.('Location permission was denied or cancelled.');
                    this.stop();
                    return;
                }
                this._allowed = true;
                this._publish();
            }));

        const startOptions = new GLib.Variant('a{sv}', {
            handle_token: new GLib.Variant('s', startToken),
        });
        connection.call(BUS, ROOT, LOCATION, 'Start',
            new GLib.Variant('(osa{sv})', [this._session, '', startOptions]),
            new GLib.VariantType('(o)'), Gio.DBusCallFlags.NONE, 10000, null,
            (conn, result) => {
                try {
                    conn.call_finish(result);
                } catch (error) {
                    this._onError?.(`Could not request location: ${error.message}`);
                    this.stop();
                }
            });
    }

    _publish() {
        if (this._allowed && this._last)
            this._onLocation?.(this._last[0], this._last[1]);
    }

    refresh() {
        this._publish();
    }

    stop() {
        const connection = Gio.DBus.session;
        for (const id of this._subscriptions)
            connection.signal_unsubscribe(id);
        this._subscriptions = [];
        if (this._session) {
            connection.call(BUS, this._session, SESSION, 'Close', null, null,
                Gio.DBusCallFlags.NONE, 1000, null, null);
        }
        this._session = null;
        this._allowed = false;
        this._last = null;
    }
}

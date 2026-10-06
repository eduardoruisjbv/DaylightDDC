import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const NAME = 'io.github.daylightddc.Service';
export const PATH = '/io/github/daylightddc/Service';
const XML = `<node><interface name="${NAME}">
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
</interface></node>`;
const Proxy = Gio.DBusProxy.makeProxyWrapper(XML);

export function connect(callback) {
    return new Proxy(Gio.DBus.session, NAME, PATH, callback);
}

export function call(proxy, method, args, callback) {
    const types = {SetConfig: '(s)', SetAutomatic: '(b)', SetProfile: '(s)', SetBrightness: '(iu)',
        SetLocationEnabled: '(b)', SetLocation: '(dd)'};
    proxy.call(method, types[method] ? new GLib.Variant(types[method], args) : null,
        Gio.DBusCallFlags.NONE, 5000, null, (source, result) => {
            try {
                callback?.(source.call_finish(result).deepUnpack(), null);
            } catch (error) {
                callback?.(null, error);
            }
        });
}

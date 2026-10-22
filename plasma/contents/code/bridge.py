#!/usr/bin/env python3
"""Small synchronous D-Bus bridge for the Plasma widget."""
import json
import sys

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

NAME = 'io.github.daylightddc.Service'
PATH = '/io/github/daylightddc/Service'
INTERFACE = NAME
XML = f'''<node><interface name="{INTERFACE}">
<method name="GetState"><arg type="s" direction="out"/></method>
<method name="SetAutomatic"><arg type="b" direction="in"/></method>
<method name="SetProfile"><arg type="s" direction="in"/></method>
<method name="SetBrightness"><arg type="i" direction="in"/><arg type="u" direction="in"/></method>
<method name="Resume"/><method name="Rescan"/>
</interface></node>'''


def main():
    method = sys.argv[1] if len(sys.argv) > 1 else 'GetState'
    values = sys.argv[2:]
    # Build only the requested variant: argument-less methods such as GetState
    # must not index into an empty argv.
    variants = {
        'SetAutomatic': lambda: GLib.Variant('(b)', (values[0].lower() == 'true',)),
        'SetProfile': lambda: GLib.Variant('(s)', (values[0],)),
        'SetBrightness': lambda: GLib.Variant('(iu)', (int(values[0]), int(values[1]))),
    }
    try:
        params = variants[method]() if method in variants else None
        connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        result = connection.call_sync(NAME, PATH, INTERFACE, method, params,
                                      GLib.VariantType.new('(s)') if method == 'GetState' else None,
                                      Gio.DBusCallFlags.NONE, 5000, None)
        if method == 'GetState':
            print(result.unpack()[0])
        else:
            print(json.dumps({'ok': True}))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

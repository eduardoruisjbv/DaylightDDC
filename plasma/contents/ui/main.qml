import QtQuick
import QtCore
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasma5support as Plasma5Support

PlasmoidItem {
    id: root
    compactRepresentation: Item {
        implicitWidth: compactRow.implicitWidth
        implicitHeight: compactRow.implicitHeight
        RowLayout {
            id: compactRow
            anchors.centerIn: parent
            spacing: 4
            PlasmaCore.IconItem { source: "video-display-brightness"; implicitWidth: 16; implicitHeight: 16 }
            Controls.Label { text: root.level === null ? "—" : root.level + "%" }
        }
    }

    property var stateData: null
    property int level: stateData ? (stateData.override_brightness !== null ? stateData.override_brightness :
        (stateData.monitors.find(m => !m.excluded && !m.error)?.brightness ?? stateData.scheduled_brightness)) : 0
    property bool busy: false
    property string helper: "\"" + StandardPaths.writableLocation(StandardPaths.HomeLocation) + "/.local/bin/daylight-ddc-plasma-bridge\""

    Plasma5Support.DataSource {
        id: runner
        engine: "executable"
        connectedSources: []
        onNewData: (sourceName, data) => {
            disconnectSource(sourceName)
            root.busy = false
            if (!data.stdout) return
            try {
                const parsed = JSON.parse(data.stdout.trim())
                if (parsed.error) root.errorText = parsed.error
                else if (sourceName.includes("GetState")) { root.stateData = parsed; root.errorText = "" }
            } catch (e) { root.errorText = data.stderr || String(e) }
        }
    }
    property string errorText: ""
    function run(method, args) {
        if (busy) return
        busy = true
        const command = helper + " " + method + (args ? " " + args : "")
        runner.connectSource(command)
    }
    function shellArg(value) { return "'" + String(value).replaceAll("'", "'\\''") + "'" }
    function refresh() { run("GetState", "") }

    Plasmoid.backgroundHints: PlasmaCore.Types.DefaultBackground
    Timer { interval: 3000; running: true; repeat: true; onTriggered: if (!root.busy) root.refresh() }
    Component.onCompleted: refresh()

    fullRepresentation: ColumnLayout {
        Layout.minimumWidth: 310
        Layout.preferredWidth: 350
        Layout.minimumHeight: 300
        spacing: 10
        Controls.Label {
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            text: root.errorText || (root.stateData ? root.statusText() : "Conectando ao serviço Daylight DDC…")
        }
        RowLayout {
            Layout.fillWidth: true
            Controls.Label { text: "Perfil" }
            Controls.ComboBox {
                id: profile
                Layout.fillWidth: true
                textRole: "label"
                model: [
                    {label: "Natural", value: "natural"},
                    {label: "Cortinas", value: "curtains"},
                    {label: "Apple (experimental)", value: "apple_like"},
                    {label: "Personalizado", value: "custom"}
                ]
                Component.onCompleted: syncProfile()
                function syncProfile() {
                    const value = root.stateData?.config?.profile || "natural"
                    currentIndex = model.findIndex(item => item.value === value)
                }
                onActivated: index => root.run("SetProfile", root.shellArg(model[index].value))
                Connections { target: root; function onStateDataChanged() { profile.syncProfile() } }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            Controls.Label { text: "Automático"; Layout.fillWidth: true }
            Controls.Switch {
                checked: root.stateData?.config?.automatic ?? false
                onClicked: root.run("SetAutomatic", checked ? "true" : "false")
            }
        }
        Controls.Label { text: "Brilho manual: " + root.level + "%" }
        Controls.Slider {
            id: slider
            Layout.fillWidth: true
            from: 0; to: 100; stepSize: 1
            value: root.level
            onMoved: debounce.restart()
            Timer {
                id: debounce
                interval: 350
                onTriggered: root.run("SetBrightness", Math.round(slider.value) + " 3600")
            }
        }
        RowLayout {
            Layout.fillWidth: true
            Controls.Button { text: "Retomar automático"; onClicked: root.run("Resume", "") }
            Controls.Button { text: "Redetectar"; onClicked: root.run("Rescan", "") }
        }
        Item { Layout.fillHeight: true }
    }

    function statusText() {
        if (!stateData) return "Conectando…"
        const active = stateData.monitors.filter(m => !m.excluded && !m.error)
        if (stateData.error) return "Falha: " + stateData.error
        if (!active.length) return "Nenhum monitor DDC disponível"
        let value = active.length + (active.length === 1 ? " monitor" : " monitores") + " · " + root.level + "%"
        if (stateData.override_brightness !== null) value += " · manual por 1 hora"
        return value
    }
}

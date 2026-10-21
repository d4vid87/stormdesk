import QtQuick
import QtWebView

WebView {
    id: radar
    signal pageLoaded(bool ok)
    url: "about:blank"
    property bool compact: false
    function fitDashboard() {
        if (!compact || loadProgress !== 100 || width <= 0) return;
        // shortcut: compact embed uses a wider viewport until HookEcho offers a small touch deck.
        const viewport = Math.max(720, Math.round(width));
        runJavaScript("document.querySelector('meta[name=viewport]').setAttribute('content'," +
                      JSON.stringify("width=" + viewport + ",initial-scale=" + (width / viewport) +
                                     ",user-scalable=no") + ")");
    }
    onWidthChanged: fitDashboard()
    settings.localStorageEnabled: true
    onLoadingChanged: function(request) {
        if (radar.url.toString() === "about:blank") return;
        if (request.status === WebView.LoadSucceededStatus) {
            radar.fitDashboard();
            radar.pageLoaded(true);
        }
        else if (request.status === WebView.LoadFailedStatus)
            radar.pageLoaded(false);
    }
}

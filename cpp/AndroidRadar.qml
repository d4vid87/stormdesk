import QtQuick
import QtWebView

WebView {
    id: radar
    signal pageLoaded(bool ok)
    url: "about:blank"
    settings.localStorageEnabled: true
    onLoadingChanged: function(request) {
        if (radar.url.toString() === "about:blank") return;
        if (request.status === WebView.LoadSucceededStatus) {
            radar.pageLoaded(true);
        }
        else if (request.status === WebView.LoadFailedStatus)
            radar.pageLoaded(false);
    }
}

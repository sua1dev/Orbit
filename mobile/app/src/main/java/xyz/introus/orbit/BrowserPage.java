package xyz.introus.orbit;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Message;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SafeBrowsingResponse;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

@SuppressLint("ViewConstructor") // Web pages are constructed with their owning activity and tab.
final class BrowserPage extends WebView {
    int progress = 100;
    String error;
    Bitmap favicon;
    final CookieManager cookies;
    private final BrowserActivity owner;
    private final TabStore.Tab tab;
    private final String mobileAgent;
    private boolean disposed;
    private long documentVersion;

    @SuppressLint("SetJavaScriptEnabled") // The web engine has no JavaScript interface to native app code.
    BrowserPage(BrowserActivity activity, TabStore.Tab tab) {
        super(activity);
        owner = activity;
        this.tab = tab;
        if (TabStore.DEFAULT.equals(tab.space)) cookies = CookieManager.getInstance();
        else if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            WebViewCompat.setProfile(this, activity.profileName(tab.space));
            cookies = WebViewCompat.getProfile(this).getCookieManager();
        } else throw new IllegalStateException("A named space requires WebView multi-profile support");
        WebSettings settings = getSettings();
        mobileAgent = settings.getUserAgentString();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSafeBrowsingEnabled(true);
        cookies.setAcceptThirdPartyCookies(this, false);
        settings.setTextZoom(tab.textZoom);
        if (tab.desktop) applyDesktopMode(true);
        if (activity.privateMode()) {
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
            setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        setOverScrollMode(OVER_SCROLL_NEVER);
        setContentDescription("웹페이지");

        setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (WebAddress.normalize(request.getUrl().toString()) != null) return false;
                if (request.isForMainFrame() && request.hasGesture()) activity.toast("Orbit에서 열 수 없는 링크예요.");
                return true;
            }

            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                if (disposed) return;
                documentVersion++;
                String address = WebAddress.normalize(url);
                if (address == null) {
                    if (!"about:blank".equals(url) || tab.url != null) stopLoading();
                    return;
                }
                updateAddress(address);
                error = null;
                progress = 0;
                activity.pageChanged(tab, BrowserPage.this, false);
            }

            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                if (disposed) return;
                String address = WebAddress.normalize(url);
                if (address != null) {
                    updateAddress(address);
                    activity.pageChanged(tab, BrowserPage.this, true);
                }
            }

            private void updateAddress(String address) {
                if (!WebAddress.displayHost(address).equals(WebAddress.displayHost(tab.url))) {
                    favicon = null;
                    tab.title = null;
                }
                tab.url = address;
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (disposed || !samePage(url)) return;
                progress = 100;
                if (error == null) {
                    tab.title = new TabStore.Page(tab.url, getTitle()).title;
                    activity.pageVisited(tab, BrowserPage.this);
                }
                activity.pageChanged(tab, BrowserPage.this, true);
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError failure) {
                if (!disposed && request.isForMainFrame() && samePage(request.getUrl().toString())) {
                    if (error == null) error = "연결이 끊겼거나 웹사이트에 접속할 수 없어요.";
                    progress = 100;
                    activity.pageFailed(tab, BrowserPage.this);
                }
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError failure) {
                handler.cancel();
                if (!disposed && samePage(failure.getUrl())) {
                    error = "이 사이트의 보안 인증서를 확인할 수 없어요.";
                    progress = 100;
                    activity.pageFailed(tab, BrowserPage.this);
                }
            }

            @Override public void onSafeBrowsingHit(WebView view, WebResourceRequest request, int threatType,
                                                    SafeBrowsingResponse response) {
                response.backToSafety(false);
                if (!disposed && request.isForMainFrame() && samePage(request.getUrl().toString())) {
                    error = "Android에서 위험하다고 판단한 사이트를 차단했어요.";
                    progress = 100;
                    activity.pageFailed(tab, BrowserPage.this);
                }
            }

            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (!disposed) activity.rendererExited(tab, BrowserPage.this);
                return true;
            }

            private boolean samePage(String url) {
                return tab.url != null && tab.url.equals(WebAddress.normalize(url));
            }
        });

        setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                if (disposed || error != null) return;
                progress = value;
                activity.pageChanged(tab, BrowserPage.this, false);
            }

            @Override public void onReceivedTitle(WebView view, String title) {
                if (disposed || tab.url == null || error != null) return;
                tab.title = new TabStore.Page(tab.url, title).title;
                activity.pageChanged(tab, BrowserPage.this, true);
            }

            @Override public void onReceivedIcon(WebView view, Bitmap icon) {
                if (disposed || icon == null || icon.getWidth() < 1 || icon.getHeight() < 1) return;
                favicon = Bitmap.createScaledBitmap(icon, 48, 48, true);
            }

            @Override public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }

            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }

            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return activity.chooseFiles(BrowserPage.this, callback, params);
            }

            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                return userGesture && activity.createPopup(tab, result);
            }

            @Override public void onCloseWindow(WebView window) {
                if (!disposed) activity.closePopup(tab);
            }

            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                activity.showVideo(BrowserPage.this, view, callback);
            }

            @Override public void onHideCustomView() { activity.hideVideo(BrowserPage.this); }
        });

        setDownloadListener(activity::confirmDownload);
        setOnLongClickListener(view -> {
            HitTestResult hit = getHitTestResult();
            if (hit == null) return false;
            String address = WebAddress.normalize(hit.getExtra());
            if (address == null) return false;
            switch (hit.getType()) {
                case HitTestResult.SRC_ANCHOR_TYPE:
                case HitTestResult.SRC_IMAGE_ANCHOR_TYPE:
                case HitTestResult.IMAGE_TYPE:
                    activity.showLinkMenu(address);
                    return true;
                default:
                    return false;
            }
        });
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) owner.focusPane(tab);
        return super.onTouchEvent(event);
    }

    long documentVersion() { return documentVersion; }

    void applyDesktopMode(boolean enabled) {
        getSettings().setUserAgentString(enabled
                ? mobileAgent.replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)").replace(" Mobile", "")
                : mobileAgent);
    }

    Bitmap thumbnail() {
        if (disposed || error != null || !isAttachedToWindow() || getWidth() == 0 || getHeight() == 0) return null;
        int width = Math.min(getWidth(), 380);
        float scale = (float) width / getWidth();
        int height = Math.min(Math.round(getHeight() * scale), 420);
        if (height < 1) return null;
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(0xffffffff);
        canvas.scale(scale, scale);
        draw(canvas);
        return bitmap;
    }

    void dispose() {
        disposed = true;
        stopLoading();
        setWebViewClient(null);
        setWebChromeClient(null);
        destroy();
    }
}

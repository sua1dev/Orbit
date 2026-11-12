package xyz.introus.orbit;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.PictureInPictureParams;
import android.app.role.RoleManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.os.Message;
import android.print.PrintManager;
import android.view.View;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.webkit.Profile;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewFeature;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class BrowserActivity extends ComponentActivity {
    private static final int MAX_LIVE_PAGES = 5;
    private final Map<TabStore.Tab, BrowserPage> pages = new LinkedHashMap<>(8, .75f, true);
    private final Map<TabStore.Tab, Bitmap> previews = new IdentityHashMap<>();
    private final java.util.Set<TabStore.Tab> popupTabs = java.util.Collections.newSetFromMap(new IdentityHashMap<>());
    SharedPreferences preferences;
    TabStore store;
    BrowserChrome chrome;
    BrowserFiles files;
    private ValueCallback<Uri[]> fileCallback;
    private View video;
    private BrowserPage videoPage;
    private WebChromeClient.CustomViewCallback videoCallback;
    private boolean wasPip;
    private final ActivityResultLauncher<Intent> browserRole = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> { });
    private final ActivityResultLauncher<Intent> filePicker = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> receiveFiles(result.getResultCode(), result.getData()));

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("orbit", MODE_PRIVATE);
        if (!privateMode()) deleteRemovedProfiles();
        store = new TabStore(privateMode() ? null : preferences);
        chrome = new BrowserChrome(this);
        files = new BrowserFiles(this);
        if (!privateMode()) sendBroadcast(new Intent(this, PrivateCleanupReceiver.class));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { browserBack(); }
        });
        renderActive();
        if (!privateMode()) openIncoming(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!privateMode()) openIncoming(intent);
    }

    @Override public boolean onKeyShortcut(int keyCode, KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.isCtrlPressed() && !event.isAltPressed()
                && chrome != null && video == null) {
            boolean shift = event.isShiftPressed();
            switch (keyCode) {
                case KeyEvent.KEYCODE_L:
                    chrome.showSearch(false);
                    return true;
                case KeyEvent.KEYCODE_T:
                    if (shift) { if (!store.closed.isEmpty()) restore(store.closed.get(0)); }
                    else newTab();
                    return true;
                case KeyEvent.KEYCODE_A:
                    if (shift) { chrome.showTabs(); return true; }
                    break;
                case KeyEvent.KEYCODE_F:
                    chrome.findActive();
                    return true;
                case KeyEvent.KEYCODE_W:
                    chrome.dismissPanel();
                    close(store.active);
                    return true;
                case KeyEvent.KEYCODE_D:
                    toggleBookmark();
                    return true;
                case KeyEvent.KEYCODE_TAB:
                    step(shift ? -1 : 1);
                    return true;
            }
        }
        return super.onKeyShortcut(keyCode, event);
    }

    private void openIncoming(Intent intent) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        String address = WebAddress.normalize(intent.getData().toString());
        setIntent(new Intent(Intent.ACTION_MAIN));
        if (address == null) {
            toast("올바른 웹 주소가 아니에요.");
            return;
        }
        open(address, store.active.url != null);
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (video != null) return;
        chrome.dismissPanel();
        chrome.updateTheme();
        renderActive();
    }

    @Override protected void onResume() {
        super.onResume();
        for (BrowserPage page : pages.values()) if (page.isAttachedToWindow()) page.onResume();
        chrome.resume();
    }

    @Override protected void onPause() {
        chrome.pause();
        if (!isInPictureInPictureMode() && video == null)
            for (BrowserPage page : pages.values()) if (page.isAttachedToWindow()) page.onPause();
        store.save();
        if (!privateMode() && !pages.isEmpty()) {
            List<CookieManager> managers = new ArrayList<>();
            for (BrowserPage page : pages.values()) if (!managers.contains(page.cookies)) managers.add(page.cookies);
            managers.forEach(CookieManager::flush);
        }
        super.onPause();
    }

    @Override protected void onDestroy() {
        hideVideo();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        for (BrowserPage page : pages.values()) destroy(page);
        pages.clear();
        previews.clear();
        super.onDestroy();
    }

    private void browserBack() {
        if (video != null) { hideVideo(); return; }
        if (chrome.backPanel()) return;
        if (goBack()) return;
        if (store.isSplitTab(store.active)) { endSplit(); return; }
        if (privateMode()) finishAndRemoveTask();
        else finish();
    }

    boolean goBack() {
        BrowserPage page = activePage();
        if (page == null || !page.canGoBack()) return false;
        page.goBack();
        return true;
    }

    void goForward() {
        BrowserPage page = activePage();
        if (page != null && page.canGoForward()) page.goForward();
    }

    BrowserPage activePage() {
        return pages.get(store.active);
    }

    BrowserPage pageFor(TabStore.Tab tab) {
        return pages.get(tab);
    }

    Bitmap previewFor(TabStore.Tab tab) {
        return previews.get(tab);
    }

    void savePreview() {
        BrowserPage page = activePage();
        if (page == null || page.progress < 100) return;
        Bitmap thumbnail = page.thumbnail();
        if (thumbnail != null) previews.put(store.active, thumbnail);
    }

    void select(TabStore.Tab tab) {
        if (!store.tabs.contains(tab)) return;
        boolean spaceChanged = !store.active.space.equals(tab.space);
        if (store.active != tab) {
            savePreview();
            pauseActivePage();
            if (!store.isSplitTab(tab)) store.clearSplit();
            store.active = tab;
        }
        chrome.dismissPanel();
        if (spaceChanged) chrome.updateTheme();
        renderActive();
        store.save();
    }

    void step(int direction) {
        List<TabStore.Tab> visible = store.currentTabs();
        int index = visible.indexOf(store.active) + direction;
        if (index >= 0 && index < visible.size()) select(visible.get(index));
    }

    void newTab() {
        savePreview();
        BrowserPage previous = activePage();
        TabStore.Tab tab = store.add(null, null);
        if (tab == null) {
            toast("열린 탭을 닫은 뒤 새 탭을 추가해 주세요.");
            return;
        }
        if (previous != null) previous.onPause();
        store.clearSplit();
        chrome.dismissPanel();
        renderActive();
        store.save();
        if (preferences.getBoolean("focusNewTab", true)) chrome.showSearch(true);
    }

    void close(TabStore.Tab tab) {
        BrowserPage removed = pages.remove(tab);
        if (removed != null) destroy(removed);
        previews.remove(tab);
        popupTabs.remove(tab);
        store.close(tab);
        renderActive();
        store.save();
    }

    void restore(TabStore.Page entry) {
        BrowserPage previous = activePage();
        if (store.restore(entry) == null) {
            toast("열린 탭을 닫은 뒤 다시 시도해 주세요.");
            return;
        }
        if (previous != null) previous.onPause();
        store.clearSplit();
        chrome.dismissPanel();
        renderActive();
        store.save();
    }

    void search(String text) {
        String address = WebAddress.resolve(text, searchEngine());
        if (address == null) {
            toast("올바른 웹 주소를 입력해 주세요.");
            return;
        }
        if (preferences.getBoolean("saveHistory", true) && address.startsWith(searchEngine().prefix))
            store.rememberSearch(text);
        open(address, false);
    }

    void open(String address, boolean newTab) {
        String safe = WebAddress.normalize(address);
        if (safe == null) return;
        chrome.dismissPanel();
        TabStore.Tab tab = store.active;
        if (newTab) {
            savePreview();
            BrowserPage previous = activePage();
            tab = store.add(safe, null);
            if (tab == null) {
                toast("열린 탭을 닫은 뒤 새 탭을 추가해 주세요.");
                return;
            }
            if (previous != null) previous.onPause();
            store.clearSplit();
            renderActive();
        } else {
            if (!WebAddress.displayHost(safe).equals(WebAddress.displayHost(tab.url))) tab.title = null;
            tab.url = safe;
            previews.remove(tab);
            BrowserPage page = pages.get(tab);
            if (page == null) renderActive();
            else {
                page.error = null;
                page.progress = 0;
                renderActive();
                page.loadUrl(safe);
            }
        }
        store.save();
    }

    void reload() {
        if (store.active.url == null) return;
        BrowserPage page = activePage();
        if (page == null) renderActive();
        else if (page.error != null) open(store.active.url, false);
        else page.reload();
    }

    void renderActive() {
        TabStore.Tab tab = store.active;
        if (store.isSplitTab(tab)) {
            BrowserPage first = ensurePage(store.splitFirst), second = ensurePage(store.splitSecond);
            chrome.presentSplit(first, second);
            if (first != null) first.onResume();
            if (second != null) second.onResume();
        } else {
            BrowserPage page = ensurePage(tab);
            chrome.present(tab, page);
            if (page != null) page.onResume();
        }
        for (BrowserPage page : pages.values()) if (!page.isAttachedToWindow() && page.getParent() == null) page.onPause();
    }

    private BrowserPage ensurePage(TabStore.Tab tab) {
        BrowserPage current = pages.get(tab);
        if (current != null || tab.url == null) return current;
        if (!TabStore.DEFAULT.equals(tab.space) && !canUseSpaces()) return null;
        BrowserPage page = new BrowserPage(this, tab);
        retainPage(tab, page);
        page.progress = 0;
        page.loadUrl(tab.url);
        return page;
    }

    private void retainPage(TabStore.Tab tab, BrowserPage page) {
        pages.put(tab, page);
        if (pages.size() > MAX_LIVE_PAGES) {
            TabStore.Tab oldest = null;
            for (TabStore.Tab candidate : pages.keySet()) {
                if (candidate != tab && candidate != store.active && !store.isSplitTab(candidate)) {
                    oldest = candidate;
                    break;
                }
            }
            if (oldest != null) destroy(pages.remove(oldest));
        }
    }

    private void pauseActivePage() {
        BrowserPage page = activePage();
        if (page != null) page.onPause();
    }

    private void destroy(BrowserPage page) {
        if (page.getParent() instanceof ViewGroup) ((ViewGroup) page.getParent()).removeView(page);
        page.dispose();
    }

    void pageChanged(TabStore.Tab tab, BrowserPage page, boolean persist) {
        if (!store.tabs.contains(tab)) return;
        if (tab == store.active) {
            if (tab.url != null && page.error == null && page.getParent() == null) renderActive();
            else chrome.updateBar(tab, page);
        }
        if (store.isSplitTab(tab)) chrome.updateSplitFocus();
        if (persist) store.save();
    }

    void pageFailed(TabStore.Tab tab, BrowserPage page) {
        if (tab == store.active || store.isSplitTab(tab)) renderActive();
    }

    void rendererExited(TabStore.Tab tab, BrowserPage page) {
        if (pages.remove(tab) != page) return;
        destroy(page);
        if (tab == store.active || store.isSplitTab(tab)) {
            store.clearSplit();
            chrome.showCrash(store.active);
        }
    }

    void toggleBookmark() {
        TabStore.Tab tab = store.active;
        if (tab.url == null || privateMode()) return;
        if (!store.hasBookmark(tab.url) && store.bookmarks.size() >= TabStore.MAX_BOOKMARKS) {
            toast("즐겨찾기를 정리한 뒤 추가해 주세요.");
            return;
        }
        boolean added = store.toggleBookmark(tab.url, tab.label());
        store.save();
        toast(added ? "즐겨찾기에 추가했어요." : "즐겨찾기에서 제거했어요.");
    }

    void removeBookmark(TabStore.Page page) {
        store.bookmarks.remove(page);
        store.save();
        if (store.active.url == null) renderActive();
    }

    boolean privateMode() { return false; }

    void openPrivate() {
        chrome.dismissPanel();
        if (privateMode()) finishAndRemoveTask();
        else startActivity(new Intent(this, PrivateBrowserActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    boolean canUseSpaces() {
        return !privateMode() && WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
    }

    String profileName(String space) { return "orbit_space_" + space.replace("-", ""); }

    void switchSpace(TabStore.Space space) {
        if (!TabStore.DEFAULT.equals(space.id) && !canUseSpaces()) {
            toast("Android System WebView를 업데이트하면 이 스페이스를 열 수 있어요.");
            return;
        }
        if (space == store.activeSpace()) { chrome.dismissPanel(); return; }
        for (TabStore.Tab tab : store.tabs) {
            if (tab.space.equals(space.id)) { select(tab); chrome.updateTheme(); renderActive(); return; }
        }
        if (store.tabs.size() >= TabStore.MAX_TABS) { toast("탭을 닫은 뒤 다시 시도해 주세요."); return; }
        pauseActivePage();
        store.clearSplit();
        store.add(null, null, space.id);
        chrome.dismissPanel();
        chrome.updateTheme();
        renderActive();
        store.save();
    }

    void startSplit(TabStore.Tab second) {
        TabStore.Tab first = store.active;
        if (second == null) {
            second = store.add(null, null);
            if (second == null) { toast("탭을 닫은 뒤 다시 시도해 주세요."); return; }
        }
        if (first == second || !first.space.equals(second.space)) return;
        store.setSplit(first, second);
        chrome.dismissPanel();
        renderActive();
        store.save();
    }

    void moveTab(TabStore.Tab tab, TabStore.Space target) {
        if (!canUseSpaces() || !store.tabs.contains(tab) || tab.space.equals(target.id)) return;
        BrowserPage page = pages.remove(tab);
        if (page != null) destroy(page);
        previews.remove(tab);
        popupTabs.remove(tab);
        store.clearSplit();
        tab.space = target.id;
        tab.group = null;
        select(tab);
        chrome.updateTheme();
        renderActive();
    }

    void deleteSpace(TabStore.Space space) {
        if (privateMode() || TabStore.DEFAULT.equals(space.id) || !store.spaces.contains(space)) return;
        if (space == store.activeSpace()) store.clearSplit();
        for (TabStore.Tab tab : new ArrayList<>(pages.keySet())) {
            if (!tab.space.equals(space.id)) continue;
            destroy(pages.remove(tab));
        }
        previews.keySet().removeIf(tab -> tab.space.equals(space.id));
        popupTabs.removeIf(tab -> tab.space.equals(space.id));
        store.tabs.removeIf(tab -> tab.space.equals(space.id));
        store.closed.removeIf(page -> page.space.equals(space.id));
        store.history.removeIf(page -> page.space.equals(space.id));
        store.searches.removeIf(entry -> entry.space.equals(space.id));
        store.groups.removeIf(group -> group.space.equals(space.id));
        store.shortcutPanels.remove(space.id);
        store.spaces.remove(space);
        if (!store.tabs.contains(store.active)) {
            store.active = null;
            for (TabStore.Tab tab : store.tabs) {
                if (TabStore.DEFAULT.equals(tab.space)) { store.active = tab; break; }
            }
            if (store.active == null) store.add(null, null, TabStore.DEFAULT);
        }
        java.util.Set<String> pending = new java.util.HashSet<>(preferences.getStringSet("deletedSpaces", java.util.Collections.emptySet()));
        pending.add(space.id);
        preferences.edit().putStringSet("deletedSpaces", pending).apply();
        deleteRemovedProfiles();
        store.save();
        chrome.dismissPanel();
        chrome.updateTheme();
        renderActive();
        toast("스페이스를 삭제했어요.");
    }

    private void deleteRemovedProfiles() {
        java.util.Set<String> pending = new java.util.HashSet<>(preferences.getStringSet("deletedSpaces", java.util.Collections.emptySet()));
        if (pending.isEmpty() || !WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return;
        java.util.Iterator<String> entries = pending.iterator();
        while (entries.hasNext()) {
            String id = entries.next();
            if (!id.matches("[a-f0-9-]{36}")) { entries.remove(); continue; }
            try {
                ProfileStore.getInstance().deleteProfile(profileName(id));
                entries.remove();
            } catch (IllegalStateException busy) {
                // WebView releases loaded profiles when its process exits.
            }
        }
        preferences.edit().putStringSet("deletedSpaces", pending).apply();
    }

    void reorder(TabStore.Tab tab, int direction) {
        List<TabStore.Tab> neighbors = new ArrayList<>();
        for (TabStore.Tab candidate : store.tabs) {
            if (candidate.space.equals(tab.space) && candidate.pinned == tab.pinned
                    && java.util.Objects.equals(candidate.group, tab.group)) neighbors.add(candidate);
        }
        int next = neighbors.indexOf(tab) + direction;
        if (next >= 0 && next < neighbors.size()) {
            java.util.Collections.swap(store.tabs, store.tabs.indexOf(tab), store.tabs.indexOf(neighbors.get(next)));
            store.save();
        }
    }

    void focusPane(TabStore.Tab tab) {
        if (store.isSplitTab(tab) && store.active != tab) {
            store.active = tab;
            chrome.updateSplitFocus();
            store.save();
        }
    }

    void endSplit() {
        store.clearSplit();
        chrome.dismissPanel();
        renderActive();
        store.save();
    }

    void duplicate(TabStore.Tab tab) {
        if (tab.url == null) { newTab(); return; }
        if (!tab.space.equals(store.active.space)) select(tab);
        if (store.tabs.size() >= TabStore.MAX_TABS) { toast("탭을 닫은 뒤 다시 시도해 주세요."); return; }
        open(tab.url, true);
        if (store.active != tab && store.active.url != null && store.active.url.equals(tab.url)) {
            store.active.group = tab.group;
            store.active.pinned = tab.pinned;
            store.save();
        }
    }

    boolean createPopup(TabStore.Tab opener, Message result) {
        if (!store.tabs.contains(opener) || !opener.space.equals(store.active.space)
                || !(result.obj instanceof WebView.WebViewTransport)) return false;
        savePreview();
        BrowserPage previous = activePage();
        TabStore.Tab popup = store.add(null, null);
        if (popup == null) { toast("탭을 닫은 뒤 다시 시도해 주세요."); return false; }
        if (previous != null) previous.onPause();
        store.clearSplit();
        popup.group = opener.group;
        popupTabs.add(popup);
        BrowserPage page = new BrowserPage(this, popup);
        retainPage(popup, page);
        chrome.present(popup, page);
        ((WebView.WebViewTransport) result.obj).setWebView(page);
        result.sendToTarget();
        return true;
    }

    void closePopup(TabStore.Tab tab) { if (popupTabs.contains(tab)) close(tab); }

    void pageVisited(TabStore.Tab tab, BrowserPage page) {
        if (pages.get(tab) != page || !preferences.getBoolean("saveHistory", true)) return;
        store.visit(tab);
        store.save();
    }

    void requestDefaultBrowser() {
        RoleManager roles = getSystemService(RoleManager.class);
        if (roles == null || !roles.isRoleAvailable(RoleManager.ROLE_BROWSER)) {
            toast("이 기기에서는 기본 브라우저 역할을 변경할 수 없어요.");
        } else if (roles.isRoleHeld(RoleManager.ROLE_BROWSER)) {
            toast("Orbit이 기본 브라우저로 설정되어 있어요.");
        } else browserRole.launch(roles.createRequestRoleIntent(RoleManager.ROLE_BROWSER));
    }

    void openAutofill() {
        try { startActivity(new Intent("android.settings.AUTOFILL_SETTINGS")); }
        catch (RuntimeException unavailable) { startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS)); }
    }

    void clearSiteData() {
        String space = store.active.space;
        CookieManager cookies = CookieManager.getInstance();
        WebStorage storage = WebStorage.getInstance();
        if (!TabStore.DEFAULT.equals(space)) {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
                toast("Android System WebView를 업데이트해 주세요."); return;
            }
            Profile profile = ProfileStore.getInstance().getProfile(profileName(space));
            if (profile == null) { toast("저장된 사이트 데이터가 없어요."); return; }
            cookies = profile.getCookieManager();
            storage = profile.getWebStorage();
        }
        CookieManager target = cookies;
        for (TabStore.Tab tab : new ArrayList<>(pages.keySet())) {
            if (!tab.space.equals(space)) continue;
            BrowserPage page = pages.remove(tab);
            // WebView's HTTP resource cache is shared inside this process.
            page.clearCache(true);
            destroy(page);
        }
        storage.deleteAllData();
        target.removeAllCookies(removed -> {
            target.flush();
            if (isDestroyed() || isFinishing()) return;
            toast("현재 스페이스의 쿠키와 웹 저장소를 지웠어요.");
            renderActive();
        });
    }

    void printPage() {
        BrowserPage page = activePage();
        if (page == null || page.error != null || privateMode()) return;
        String title = store.active.label();
        getSystemService(PrintManager.class).print(title, page.createPrintDocumentAdapter(title), null);
    }

    void showVideo(BrowserPage page, View view, WebChromeClient.CustomViewCallback callback) {
        if (page != activePage() || video != null) { callback.onCustomViewHidden(); return; }
        chrome.dismissPanel();
        video = view;
        videoPage = page;
        videoCallback = callback;
        chrome.fullscreen(view);
        if (Build.VERSION.SDK_INT >= 31 && supportsPip()) view.post(() -> {
            if (video != view) return;
            Rect rect = new Rect();
            PictureInPictureParams.Builder params = new PictureInPictureParams.Builder()
                    .setAutoEnterEnabled(preferences.getBoolean("autoPip", true));
            if (view.getGlobalVisibleRect(rect) && !rect.isEmpty()) params.setSourceRectHint(rect);
            setPictureInPictureParams(params.build());
        });
    }

    void hideVideo() {
        if (video == null) return;
        video = null;
        videoPage = null;
        WebChromeClient.CustomViewCallback callback = videoCallback;
        videoCallback = null;
        chrome.fullscreen(null);
        if (Build.VERSION.SDK_INT >= 31 && supportsPip())
            setPictureInPictureParams(new PictureInPictureParams.Builder().setAutoEnterEnabled(false).build());
        callback.onCustomViewHidden();
    }

    void hideVideo(BrowserPage page) { if (videoPage == page) hideVideo(); }

    @Override protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < 31 && video != null && supportsPip() && preferences.getBoolean("autoPip", true)) {
            enterPictureInPictureMode(new PictureInPictureParams.Builder().build());
        }
    }

    private boolean supportsPip() {
        return !privateMode() && getPackageManager().hasSystemFeature("android.software.picture_in_picture");
    }

    @Override public void onPictureInPictureModeChanged(boolean enabled, Configuration configuration) {
        super.onPictureInPictureModeChanged(enabled, configuration);
        if (wasPip && !enabled && isFinishing()) hideVideo();
        wasPip = enabled;
    }

    void downloads() {
        try { startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)); }
        catch (RuntimeException unavailable) { toast("다운로드 목록을 열 수 없어요."); }
    }

    WebAddress.SearchEngine searchEngine() {
        try {
            return WebAddress.SearchEngine.valueOf(preferences.getString("engine", "GOOGLE"));
        } catch (IllegalArgumentException invalid) {
            return WebAddress.SearchEngine.GOOGLE;
        }
    }

    void share(String address) {
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, address);
        startActivity(Intent.createChooser(send, "링크 공유"));
    }

    void copy(String address) {
        getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Orbit 링크", address));
        toast("주소를 복사했어요.");
    }

    void showLinkMenu(String address) {
        new AlertDialog.Builder(this).setTitle(WebAddress.displayHost(address))
                .setItems(new String[]{"새 탭에서 열기", "주소 복사", "공유"}, (dialog, option) -> {
                    if (option == 0) open(address, true);
                    else if (option == 1) copy(address);
                    else share(address);
                }).show();
    }

    boolean chooseFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        try {
            filePicker.launch(params.createIntent());
        } catch (RuntimeException unavailable) {
            fileCallback = null;
            callback.onReceiveValue(null);
            toast("파일 선택 앱을 열 수 없어요.");
        }
        return true;
    }

    private void receiveFiles(int result, Intent data) {
        if (fileCallback == null) return;
        Uri[] selected = WebChromeClient.FileChooserParams.parseResult(result, data);
        if (selected != null) {
            for (Uri uri : selected) {
                if (uri == null || !"content".equals(uri.getScheme())) {
                    selected = null;
                    break;
                }
            }
        }
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        callback.onReceiveValue(selected);
    }

    void confirmDownload(String url, String agent, String disposition, String mime, long size) {
        String address = WebAddress.normalize(url);
        if (address == null) {
            toast("이 형식의 다운로드는 지원하지 않아요.");
            return;
        }
        String guessed = URLUtil.guessFileName(address, disposition, mime)
                .replaceAll("[\\\\/:*?<>|\\p{Cntrl}]", "_");
        String filename = guessed.isEmpty() || guessed.equals(".") || guessed.equals("..")
                ? "orbit-download" : guessed.substring(0, Math.min(guessed.length(), 160));
        new AlertDialog.Builder(this).setTitle("파일 다운로드")
                .setMessage(filename + "\n" + WebAddress.displayHost(address))
                .setNegativeButton("취소", null)
                .setPositiveButton("다운로드", (dialog, button) -> {
                    try {
                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(address))
                                .setTitle(filename)
                                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                        if (mime != null && !mime.isEmpty()) request.setMimeType(mime);
                        if (agent != null && !agent.isEmpty()) request.addRequestHeader("User-Agent", agent);
                        getSystemService(DownloadManager.class).enqueue(request);
                        toast("다운로드를 시작했어요.");
                    } catch (RuntimeException unavailable) {
                        toast("다운로드를 시작할 수 없어요.");
                    }
                }).show();
    }

    void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }
}

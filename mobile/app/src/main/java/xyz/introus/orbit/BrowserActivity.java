package xyz.introus.orbit;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.Map;

public final class BrowserActivity extends ComponentActivity {
    private static final int MAX_LIVE_PAGES = 5;
    private final Map<TabStore.Tab, BrowserPage> pages = new LinkedHashMap<>(8, .75f, true);
    private final Map<TabStore.Tab, Bitmap> previews = new IdentityHashMap<>();
    SharedPreferences preferences;
    TabStore store;
    private BrowserChrome chrome;
    private ValueCallback<Uri[]> fileCallback;
    private final ActivityResultLauncher<Intent> filePicker = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> receiveFiles(result.getResultCode(), result.getData()));

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("orbit", MODE_PRIVATE);
        store = new TabStore(preferences);
        chrome = new BrowserChrome(this);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { browserBack(); }
        });
        renderActive();
        openIncoming(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openIncoming(intent);
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
        chrome.dismissPanel();
        chrome.updateTheme();
        renderActive();
    }

    @Override protected void onResume() {
        super.onResume();
        BrowserPage page = activePage();
        if (page != null) page.onResume();
        chrome.resume();
    }

    @Override protected void onPause() {
        chrome.pause();
        BrowserPage page = activePage();
        if (page != null) page.onPause();
        store.save();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        for (BrowserPage page : pages.values()) destroy(page);
        pages.clear();
        previews.clear();
        super.onDestroy();
    }

    private void browserBack() {
        if (chrome.dismissPanel()) return;
        if (!goBack()) finish();
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
        if (store.active != tab) {
            savePreview();
            pauseActivePage();
            store.active = tab;
        }
        chrome.dismissPanel();
        renderActive();
        store.save();
    }

    void step(int direction) {
        int index = store.tabs.indexOf(store.active) + direction;
        if (index >= 0 && index < store.tabs.size()) select(store.tabs.get(index));
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
        chrome.dismissPanel();
        renderActive();
        store.save();
        chrome.showSearch(true);
    }

    void close(TabStore.Tab tab) {
        BrowserPage removed = pages.remove(tab);
        if (removed != null) destroy(removed);
        previews.remove(tab);
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
                chrome.present(tab, page);
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

    private void renderActive() {
        TabStore.Tab tab = store.active;
        BrowserPage page = pages.get(tab);
        if (page == null && tab.url != null) {
            page = new BrowserPage(this, tab);
            pages.put(tab, page);
            if (pages.size() > MAX_LIVE_PAGES) {
                TabStore.Tab oldest = pages.keySet().iterator().next();
                destroy(pages.remove(oldest));
            }
            page.progress = 0;
            page.loadUrl(tab.url);
        }
        if (page != null) page.onResume();
        chrome.present(tab, page);
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
        if (tab == store.active) chrome.updateBar(tab, page);
        if (persist) store.save();
    }

    void pageFailed(TabStore.Tab tab, BrowserPage page) {
        if (tab == store.active) chrome.present(tab, page);
    }

    void rendererExited(TabStore.Tab tab, BrowserPage page) {
        if (pages.remove(tab) != page) return;
        destroy(page);
        if (tab == store.active) chrome.showCrash(tab);
    }

    void toggleBookmark() {
        TabStore.Tab tab = store.active;
        if (tab.url == null) return;
        boolean added = store.toggleBookmark(tab.url, tab.label());
        store.save();
        toast(added ? "즐겨찾기에 추가했어요." : "즐겨찾기에서 제거했어요.");
    }

    void removeBookmark(TabStore.Page page) {
        store.bookmarks.remove(page);
        store.save();
        if (store.active.url == null) renderActive();
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

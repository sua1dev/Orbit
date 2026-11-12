package xyz.introus.orbit;

import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.text.Html;
import android.text.Spanned;
import android.text.style.URLSpan;
import android.util.Base64;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class BrowserFiles {
    private static final int IMAGE_LIMIT = 12 * 1024 * 1024;
    private static final int PROFILE_LIMIT = 768 * 1024;
    private static final String JPEG = "data:image/jpeg;base64,";
    private static final String[] OPTIONS = {"theme", "density", "corners", "dialSize",
            "toolbarPosition", "splitDirection", "tabStyle", "sidebar", "tabPosition", "clockStyle"};
    private static final String[] TOGGLES = {"showShortcuts", "showClock", "showWeather", "showDashboard",
            "showTabClose", "showPasswordTool", "showFavoriteTool", "showPipTool", "showSplitTool",
            "showTabSearchTool", "focusNewTab", "animations", "showPresets"};
    private static final String[] VALUES = {"space/system/light/dark", "comfortable/compact", "soft/square/round",
            "medium/small/large", "top/bottom", "auto/side/stacked", "cards/list", "left/right", "top/side", "gradient/plain"};
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private final BrowserActivity activity;
    private final ActivityResultLauncher<String[]> reader;
    private final ActivityResultLauncher<String> writer;
    private final ActivityResultLauncher<String> pngWriter;
    private String readOperation;
    private byte[] pendingExport;
    private Bitmap pendingCard, image;
    private String imageKey;

    BrowserFiles(BrowserActivity activity) {
        this.activity = activity;
        reader = activity.getActivityResultRegistry().register("orbit-file-reader", activity,
                new ActivityResultContracts.OpenDocument(), this::read);
        writer = activity.getActivityResultRegistry().register("orbit-file-writer", activity,
                new ActivityResultContracts.CreateDocument("application/json"), this::write);
        pngWriter = activity.getActivityResultRegistry().register("orbit-card-writer", activity,
                new ActivityResultContracts.CreateDocument("image/png"), this::writeCard);
    }

    void chooseImage() { choose("image", new String[]{"image/jpeg", "image/png"}); }
    void importAppearance() { choose("appearance", new String[]{"application/json", "text/plain", "application/octet-stream"}); }
    void importBookmarks() { choose("bookmarks", new String[]{"text/html", "application/json", "text/plain", "application/octet-stream"}); }

    private void choose(String operation, String[] types) {
        if (activity.privateMode()) return;
        readOperation = operation;
        reader.launch(types);
    }

    private void read(Uri uri) {
        String operation = readOperation;
        readOperation = null;
        if (uri == null || operation == null || !"content".equals(uri.getScheme())) return;
        IO.execute(() -> {
            try {
                byte[] bytes = readBytes(uri, operation.equals("image") ? IMAGE_LIMIT :
                        operation.equals("bookmarks") ? 3 * 1024 * 1024 : PROFILE_LIMIT);
                if (operation.equals("image")) {
                    String encoded = encodeImage(bytes);
                    runUi(() -> {
                        activity.preferences.edit().putString("customImage", encoded).putString("scene", "custom").apply();
                        appearanceChanged("사진을 적용했어요.");
                    });
                } else {
                    String source = new String(bytes, StandardCharsets.UTF_8).replaceFirst("^\ufeff", "");
                    if (operation.equals("appearance")) {
                        JSONObject root = new JSONObject(source);
                        if (!"orbit-appearance".equals(root.optString("format")) || root.optInt("version") != 1)
                            throw new IOException("Unknown profile");
                        JSONObject data = root.getJSONObject("appearance");
                        String encoded = data.optString("customImage");
                        if (!encoded.isEmpty() && !"null".equals(encoded)) verifyImage(encoded).recycle();
                        runUi(() -> applyAppearance(data));
                    } else {
                        java.util.List<TabStore.Page> links = bookmarkLinks(source);
                        runUi(() -> {
                            int added = 0;
                            for (int i = links.size() - 1; i >= 0; i--) {
                                TabStore.Page link = links.get(i);
                                if (activity.store.addBookmark(link)) added++;
                            }
                            activity.store.save();
                            activity.renderActive();
                            activity.toast(added == 0 ? "가져올 새 주소가 없어요." : added + "개 즐겨찾기를 가져왔어요.");
                        });
                    }
                }
            } catch (Exception failure) {
                runUi(() -> activity.toast("파일 형식이나 크기를 확인해 주세요."));
            }
        });
    }

    void exportAppearance() {
        if (activity.privateMode()) return;
        try {
            SharedPreferences prefs = activity.preferences;
            JSONObject data = new JSONObject();
            for (String key : OPTIONS) if (prefs.contains(key)) data.put(key, prefs.getString(key, ""));
            data.put("tabPosition", prefs.getString("tabStyle", "cards").equals("list") ? "side" : "top");
            for (String key : TOGGLES) if (prefs.contains(key)) data.put(key, prefs.getBoolean(key, true));
            data.put("background", prefs.getString("scene", "auto"));
            data.put("backgroundColor", hex(prefs.getInt("backgroundColor", 0xff222237)));
            data.put("overlay", prefs.getInt("overlay", 35));
            data.put("sidebarWidth", prefs.getInt("sidebarWidth", 256));
            if (prefs.getInt("accent", 0) != 0) data.put("accent", hex(prefs.getInt("accent", 0)));
            if (prefs.contains("customImage")) data.put("customImage", prefs.getString("customImage", ""));
            export("orbit-appearance.json", new JSONObject().put("format", "orbit-appearance").put("version", 1)
                    .put("appearance", data));
        } catch (JSONException impossible) { throw new AssertionError(impossible); }
    }

    void exportLinks() {
        if (activity.privateMode()) return;
        try {
            JSONArray links = new JSONArray();
            for (TabStore.Page page : activity.store.bookmarks)
                links.put(new JSONObject().put("name", page.title).put("url", page.url).put("type", "url"));
            JSONArray spaces = new JSONArray();
            for (TabStore.Space space : activity.store.spaces) {
                JSONArray tabs = new JSONArray();
                for (TabStore.Tab tab : activity.store.tabs) {
                    if (tab.url == null || !space.id.equals(tab.space)) continue;
                    JSONObject item = new JSONObject().put("name", tab.label()).put("url", tab.url).put("type", "url")
                            .put("pinned", tab.pinned);
                    TabStore.Group group = activity.store.group(tab.group);
                    if (group != null) item.put("group", group.name);
                    tabs.put(item);
                }
                spaces.put(new JSONObject().put("name", space.name).put("children", tabs));
            }
            export("orbit-links.json", new JSONObject().put("format", "orbit-links").put("version", 1)
                    .put("bookmarks", links).put("spaces", spaces));
        } catch (JSONException impossible) { throw new AssertionError(impossible); }
    }

    private void export(String filename, JSONObject value) throws JSONException {
        pendingExport = value.toString(2).getBytes(StandardCharsets.UTF_8);
        writer.launch(filename);
    }

    private void write(Uri uri) {
        byte[] bytes = pendingExport;
        pendingExport = null;
        if (uri == null || bytes == null) return;
        IO.execute(() -> {
            try (OutputStream output = activity.getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IOException();
                output.write(bytes);
                runUi(() -> activity.toast("파일을 저장했어요."));
            } catch (IOException | SecurityException error) {
                runUi(() -> activity.toast("파일을 저장할 수 없어요."));
            }
        });
    }

    void exportCard(Bitmap card) {
        if (activity.privateMode()) return;
        pendingCard = card;
        pngWriter.launch("Orbit-card.png");
    }

    private void writeCard(Uri uri) {
        Bitmap card = pendingCard;
        pendingCard = null;
        if (uri == null || card == null) return;
        IO.execute(() -> {
            try (OutputStream output = activity.getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null || !card.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new IOException();
                runUi(() -> activity.toast("Orbit 카드를 저장했어요."));
            } catch (IOException | SecurityException error) {
                runUi(() -> activity.toast("카드를 저장할 수 없어요."));
            }
        });
    }

    private void applyAppearance(JSONObject data) {
        SharedPreferences.Editor edit = activity.preferences.edit();
        for (int index = 0; index < OPTIONS.length; index++) {
            String key = OPTIONS[index];
            String value = data.optString(key);
            if (value.isEmpty()) continue;
            for (String valid : VALUES[index].split("/"))
                if (valid.equals(value)) { edit.putString(key, value); break; }
        }
        for (String key : TOGGLES) if (data.opt(key) instanceof Boolean) edit.putBoolean(key, data.optBoolean(key));
        if (!data.has("tabStyle") && data.has("tabPosition"))
            edit.putString("tabStyle", "side".equals(data.optString("tabPosition")) ? "list" : "cards");
        String scene = data.optString("background", "auto");
        String encoded = data.optString("customImage");
        if (encoded.startsWith(JPEG)) edit.putString("customImage", encoded);
        else edit.remove("customImage");
        if (scene.matches("auto|day|night|rain|snow|solid|custom"))
            edit.putString("scene", scene.equals("custom") && !encoded.startsWith(JPEG) ? "auto" : scene);
        edit.putInt("overlay", Math.max(0, Math.min(85, data.optInt("overlay", 35))));
        edit.putInt("sidebarWidth", Math.max(200, Math.min(360, data.optInt("sidebarWidth", 256))));
        edit.putInt("accent", color(data.optString("accent"), 0));
        edit.putInt("backgroundColor", color(data.optString("backgroundColor"), 0xff222237));
        edit.apply();
        appearanceChanged("꾸미기 설정을 불러왔어요.");
    }

    private void appearanceChanged(String message) {
        activity.chrome.updateTheme();
        activity.renderActive();
        activity.chrome.refreshSettings();
        activity.toast(message);
    }

    Bitmap customImage() {
        String encoded = activity.preferences.getString("customImage", "");
        if (!encoded.equals(imageKey)) {
            imageKey = encoded;
            try { image = encoded.isEmpty() ? null : verifyImage(encoded); }
            catch (IOException invalid) { image = null; }
        }
        return image;
    }

    private byte[] readBytes(Uri uri, int max) throws IOException {
        try (InputStream stream = activity.getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (stream == null) throw new IOException();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                if (output.size() + count > max) throw new IOException("Input too large");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private static Bitmap decodeImage(byte[] bytes, int maxEdge) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 10000 || bounds.outHeight > 10000
                || (long) bounds.outWidth * bounds.outHeight > 32_000_000
                || !("image/jpeg".equals(bounds.outMimeType) || "image/png".equals(bounds.outMimeType))) throw new IOException();
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > maxEdge * 1.35)
            options.inSampleSize *= 2;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) throw new IOException();
        return bitmap;
    }

    private static String encodeImage(byte[] bytes) throws IOException {
        Bitmap bitmap = decodeImage(bytes, 1440);
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            for (int quality : new int[]{86, 70, 53}) {
                output.reset();
                if (bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output) && output.size() <= 384 * 1024)
                    return JPEG + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            }
            throw new IOException("Wallpaper too large");
        } finally { bitmap.recycle(); }
    }

    private static Bitmap verifyImage(String encoded) throws IOException {
        if (!encoded.startsWith(JPEG) || encoded.length() > JPEG.length() + 512 * 1024) throw new IOException();
        try {
            byte[] bytes = Base64.decode(encoded.substring(JPEG.length()), Base64.DEFAULT);
            if (bytes.length < 4 || bytes.length > 384 * 1024 || bytes[0] != (byte) 0xff || bytes[1] != (byte) 0xd8)
                throw new IOException();
            return decodeImage(bytes, 1440);
        } catch (IllegalArgumentException invalid) { throw new IOException(invalid); }
    }

    private static java.util.List<TabStore.Page> bookmarkLinks(String input) throws JSONException {
        java.util.List<TabStore.Page> links = new java.util.ArrayList<>();
        if (input.trim().startsWith("{")) {
            JSONObject root = new JSONObject(input);
            ArrayDeque<Object> queue = new ArrayDeque<>();
            if (root.has("roots")) queue.add(root.getJSONObject("roots"));
            else if ("orbit-links".equals(root.optString("format"))) {
                if (root.optJSONArray("bookmarks") != null) queue.add(root.optJSONArray("bookmarks"));
                if (root.optJSONArray("spaces") != null) queue.add(root.optJSONArray("spaces"));
            }
            int examined = 0;
            while (!queue.isEmpty() && examined++ < 5000 && links.size() < TabStore.MAX_BOOKMARKS) {
                Object node = queue.removeFirst();
                if (node instanceof JSONArray) {
                    JSONArray array = (JSONArray) node;
                    for (int i = 0; i < Math.min(5000 - queue.size(), array.length()); i++) {
                        if (array.optJSONObject(i) != null) queue.addLast(array.optJSONObject(i));
                    }
                } else if (node instanceof JSONObject) {
                    JSONObject item = (JSONObject) node;
                    addLink(links, item.optString("url"), item.optString("name"));
                    if (item.optJSONArray("children") != null) queue.addLast(item.optJSONArray("children"));
                    else {
                        java.util.Iterator<String> keys = item.keys();
                        while (keys.hasNext() && queue.size() < 5000) {
                            JSONObject branch = item.optJSONObject(keys.next());
                            if (branch != null) queue.addLast(branch);
                        }
                    }
                }
            }
        } else {
            Spanned html = Html.fromHtml(input, Html.FROM_HTML_MODE_LEGACY);
            for (URLSpan span : html.getSpans(0, html.length(), URLSpan.class)) {
                if (links.size() >= TabStore.MAX_BOOKMARKS) break;
                addLink(links, span.getURL(), html.subSequence(html.getSpanStart(span), html.getSpanEnd(span)).toString());
            }
        }
        return links;
    }

    private static void addLink(java.util.List<TabStore.Page> list, String raw, String title) {
        String url = WebAddress.normalize(raw);
        if (url != null) list.add(new TabStore.Page(url, title));
    }

    private void runUi(Runnable action) {
        activity.runOnUiThread(() -> { if (!activity.isDestroyed() && !activity.isFinishing()) action.run(); });
    }

    static int color(String value, int fallback) { return value.matches("#[a-fA-F0-9]{6}") ? Color.parseColor(value) : fallback; }
    static String hex(int value) { return String.format(java.util.Locale.ROOT, "#%06x", value & 0xffffff); }
}

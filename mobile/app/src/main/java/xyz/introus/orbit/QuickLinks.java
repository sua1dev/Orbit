package xyz.introus.orbit;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class QuickLinks {
    static final int SLOTS = 6;
    static final int ROW_LIMIT = 40;
    static final int FOLDER_LIMIT = 30;

    static final class Item {
        String title, url;
        final List<Item> links;
        boolean open;

        Item(String title, String url) {
            this.title = title;
            this.url = url;
            links = url == null ? new ArrayList<>() : null;
            open = url == null;
        }
    }

    final Item[] slots = new Item[SLOTS];
    final List<Item> rows = new ArrayList<>();

    static QuickLinks initial() {
        QuickLinks panel = new QuickLinks();
        panel.slots[0] = new Item("Google", "https://www.google.com/");
        panel.slots[1] = new Item("네이버", "https://www.naver.com/");
        panel.slots[2] = new Item("YouTube", "https://www.youtube.com/");
        panel.slots[3] = new Item("Discord", "https://discord.com/app");
        return panel;
    }

    static QuickLinks read(JSONObject value) {
        QuickLinks panel = new QuickLinks();
        JSONArray slots = value.optJSONArray("slots");
        if (slots != null) for (int i = 0; i < SLOTS; i++) panel.slots[i] = readItem(slots.optJSONObject(i), false);
        readRows(value.optJSONArray("rows"), panel.rows, ROW_LIMIT, true);
        return panel;
    }

    private static void readRows(JSONArray source, List<Item> list, int limit, boolean allowFolders) {
        if (source == null) return;
        for (int i = 0; i < Math.min(source.length(), limit); i++) {
            Item item = readItem(source.optJSONObject(i), allowFolders);
            if (item != null) list.add(item);
        }
    }

    private static Item readItem(JSONObject value, boolean allowFolder) {
        if (value == null) return null;
        if (allowFolder && value.optBoolean("folder")) {
            Item folder = new Item(TabStore.label(value.optString("title"), "폴더", 100), null);
            folder.open = value.optBoolean("open");
            readRows(value.optJSONArray("links"), folder.links, FOLDER_LIMIT, false);
            return folder;
        }
        String url = address(value.optString("url"));
        return url == null ? null : new Item(TabStore.label(value.optString("title"), WebAddress.displayHost(url), 100), url);
    }

    JSONObject json() throws JSONException {
        JSONArray icons = new JSONArray();
        for (Item item : slots) icons.put(item == null ? JSONObject.NULL : itemJson(item));
        return new JSONObject().put("slots", icons).put("rows", rowsJson(rows));
    }

    private static JSONArray rowsJson(List<Item> rows) throws JSONException {
        JSONArray values = new JSONArray();
        for (Item item : rows) values.put(itemJson(item));
        return values;
    }

    private static JSONObject itemJson(Item item) throws JSONException {
        JSONObject value = new JSONObject().put("title", item.title);
        return item.links == null ? value.put("url", item.url) :
                value.put("folder", true).put("open", item.open).put("links", rowsJson(item.links));
    }

    static String address(String raw) {
        String url = raw.trim();
        if (url.isEmpty() || url.length() > 4096) return null;
        return WebAddress.normalize(url.contains("://") ? url : "https://" + url);
    }
}

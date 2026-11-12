package xyz.introus.orbit;

import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class TabStore {
    static final int MAX_TABS = 32;
    static final int MAX_CLOSED = 20;
    static final int MAX_BOOKMARKS = 64;

    static final class Page {
        final String url;
        final String title;

        Page(String url, String title) {
            this.url = url;
            String label = title == null || title.trim().isEmpty() ? WebAddress.displayHost(url) : title.trim();
            this.title = label.substring(0, Math.min(200, label.length()));
        }
    }

    static final class Tab {
        String url;
        String title;

        Tab(String url, String title) {
            this.url = url;
            this.title = title;
        }

        String label() {
            if (url == null) return "새 탭";
            return new Page(url, title).title;
        }
    }

    final List<Tab> tabs = new ArrayList<>();
    final List<Page> closed = new ArrayList<>();
    final List<Page> bookmarks = new ArrayList<>();
    private final SharedPreferences preferences;
    Tab active;

    TabStore(SharedPreferences preferences) {
        this.preferences = preferences;
        try {
            JSONObject state = new JSONObject(preferences.getString("tabs", "{}"));
            JSONArray open = state.optJSONArray("open");
            if (open != null) {
                for (int i = 0; i < Math.min(open.length(), MAX_TABS); i++) {
                    JSONObject entry = open.optJSONObject(i);
                    if (entry == null) continue;
                    String url = WebAddress.normalize(entry.optString("url", null));
                    Tab tab = new Tab(url, entry.optString("title"));
                    tabs.add(tab);
                    if (i == state.optInt("active", -1)) active = tab;
                }
            }
            readPages(state.optJSONArray("closed"), closed, MAX_CLOSED);
            readPages(state.optJSONArray("bookmarks"), bookmarks, MAX_BOOKMARKS);
        } catch (JSONException ignored) {
            // A damaged state can be recovered by opening an empty tab.
        }
        if (tabs.isEmpty()) add(null, null);
        if (active == null) active = tabs.get(0);
    }

    Tab add(String url, String title) {
        if (tabs.size() == MAX_TABS) return null;
        Tab tab = new Tab(url, title);
        tabs.add(tab);
        active = tab;
        return tab;
    }

    void close(Tab tab) {
        int index = tabs.indexOf(tab);
        if (index < 0) return;
        if (tab.url != null) {
            closed.add(0, new Page(tab.url, tab.label()));
            if (closed.size() > MAX_CLOSED) closed.remove(MAX_CLOSED);
        }
        tabs.remove(index);
        if (tabs.isEmpty()) add(null, null);
        else if (active == tab) active = tabs.get(Math.min(index, tabs.size() - 1));
    }

    Tab restore(Page page) {
        if (!closed.contains(page)) return null;
        Tab tab = add(page.url, page.title);
        if (tab != null) closed.remove(page);
        return tab;
    }

    boolean hasBookmark(String url) {
        return bookmarks.stream().anyMatch(page -> page.url.equals(url));
    }

    boolean toggleBookmark(String url, String title) {
        if (bookmarks.removeIf(page -> page.url.equals(url))) return false;
        bookmarks.add(0, new Page(url, title));
        if (bookmarks.size() > MAX_BOOKMARKS) bookmarks.remove(MAX_BOOKMARKS);
        return true;
    }

    void save() {
        try {
            JSONArray open = new JSONArray();
            for (Tab tab : tabs) {
                open.put(new JSONObject().put("url", tab.url).put("title", tab.label()));
            }
            JSONObject state = new JSONObject().put("open", open).put("active", tabs.indexOf(active))
                    .put("closed", writePages(closed)).put("bookmarks", writePages(bookmarks));
            preferences.edit().putString("tabs", state.toString()).apply();
        } catch (JSONException impossible) {
            throw new AssertionError(impossible);
        }
    }

    private static void readPages(JSONArray entries, List<Page> pages, int max) {
        if (entries == null) return;
        for (int i = 0; i < Math.min(entries.length(), max); i++) {
            JSONObject entry = entries.optJSONObject(i);
            if (entry == null) continue;
            String url = WebAddress.normalize(entry.optString("url", null));
            if (url != null) pages.add(new Page(url, entry.optString("title")));
        }
    }

    private static JSONArray writePages(List<Page> pages) throws JSONException {
        JSONArray entries = new JSONArray();
        for (Page page : pages) entries.put(new JSONObject().put("url", page.url).put("title", page.title));
        return entries;
    }
}

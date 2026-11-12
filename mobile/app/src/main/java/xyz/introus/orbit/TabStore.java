package xyz.introus.orbit;

import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class TabStore {
    static final String DEFAULT = "default";
    static final int MAX_TABS = 64;
    static final int MAX_SPACES = 12;
    static final int MAX_GROUPS = 32;
    static final int MAX_CLOSED = 40;
    static final int MAX_BOOKMARKS = 128;
    static final int MAX_HISTORY = 200;

    static final class Space {
        final String id;
        String name;
        int color;
        Space(String id, String name, int color) { this.id = id; this.name = name; this.color = color; }
    }

    static final class Group {
        final String id, space;
        String name;
        int color;
        boolean collapsed;
        Group(String id, String space, String name, int color) {
            this.id = id; this.space = space; this.name = name; this.color = color;
        }
    }

    static final class Page {
        final String url, title, space, group;
        final boolean pinned;

        Page(String url, String title) { this(url, title, DEFAULT, null, false); }

        Page(String url, String title, String space, String group, boolean pinned) {
            this.url = url;
            this.title = label(title, WebAddress.displayHost(url), 200);
            this.space = space;
            this.group = group;
            this.pinned = pinned;
        }
    }

    static final class Tab {
        String space;
        String url, title, group;
        boolean pinned, desktop;
        int textZoom = 100;

        Tab(String url, String title, String space) {
            this.url = url;
            this.title = title;
            this.space = space;
        }

        String label() { return url == null ? "새 탭" : TabStore.label(title, WebAddress.displayHost(url), 200); }
        Page entry() { return new Page(url, label(), space, group, pinned); }
    }

    static final class Search {
        final String text, space;
        Search(String text, String space) { this.text = text; this.space = space; }
    }

    final List<Tab> tabs = new ArrayList<>();
    final List<Page> closed = new ArrayList<>();
    final List<Page> bookmarks = new ArrayList<>();
    final List<Page> history = new ArrayList<>();
    final List<Space> spaces = new ArrayList<>();
    final List<Group> groups = new ArrayList<>();
    final List<Search> searches = new ArrayList<>();
    // Preserve links from older profiles when the panel is absent.
    final java.util.Map<String, JSONObject> shortcutPanels = new java.util.LinkedHashMap<>();
    private final SharedPreferences preferences;
    Tab active, splitFirst, splitSecond;
    float splitRatio = .5f;

    TabStore(SharedPreferences preferences) {
        this.preferences = preferences;
        spaces.add(new Space(DEFAULT, "시작의 궤도", 0xff8a79d8));
        if (preferences != null) {
            try { read(new JSONObject(preferences.getString("tabs", "{}"))); }
            catch (JSONException ignored) { /* Recover with the readable entries or an empty tab. */ }
        }
        if (tabs.isEmpty()) add(null, null, DEFAULT);
        if (active == null) active = tabs.get(0);
        if (!isSplitTab(active)) clearSplit();
    }

    boolean isPrivate() { return preferences == null; }

    private void read(JSONObject state) {
        for (JSONObject value : entries(state.optJSONArray("spaces"), MAX_SPACES)) {
            String id = value.optString("id");
            if (DEFAULT.equals(id)) {
                spaces.get(0).name = label(value.optString("name"), "시작의 궤도", 40);
                spaces.get(0).color = opaque(value.optInt("color", 0xff8a79d8));
            } else if (validId(id) && space(id) == null && spaces.size() < MAX_SPACES) {
                spaces.add(new Space(id, label(value.optString("name"), "스페이스", 40),
                        opaque(value.optInt("color", 0xff8a79d8))));
            }
        }
        for (JSONObject value : entries(state.optJSONArray("groups"), MAX_GROUPS)) {
            String id = value.optString("id"), space = value.optString("space");
            if (!validId(id) || group(id) != null || space(space) == null) continue;
            Group group = new Group(id, space, label(value.optString("name"), "탭 그룹", 40),
                    opaque(value.optInt("color", 0xff8a79d8)));
            group.collapsed = value.optBoolean("collapsed");
            groups.add(group);
        }
        JSONObject shortcuts = state.optJSONObject("quickLinks");
        if (shortcuts != null) for (Space space : spaces) {
            JSONObject panel = shortcuts.optJSONObject(space.id);
            if (panel != null) shortcutPanels.put(space.id, panel);
        }
        JSONArray open = state.optJSONArray("open");
        if (open != null) {
            for (int i = 0; i < Math.min(open.length(), MAX_TABS); i++) {
                JSONObject value = open.optJSONObject(i);
                if (value == null) continue;
                String url = WebAddress.normalize(value.optString("url", null));
                Tab tab = new Tab(url, value.optString("title"), validSpace(value.optString("space")));
                tab.pinned = value.optBoolean("pinned");
                tab.desktop = value.optBoolean("desktop");
                tab.textZoom = Math.max(75, Math.min(200, value.optInt("zoom", 100)));
                tab.group = validGroup(value.optString("group"), tab.space);
                tabs.add(tab);
                if (i == state.optInt("active", -1)) active = tab;
                if (i == state.optInt("splitFirst", -1)) splitFirst = tab;
                if (i == state.optInt("splitSecond", -1)) splitSecond = tab;
            }
        }
        if (splitFirst == null || splitSecond == null || splitFirst == splitSecond
                || !splitFirst.space.equals(splitSecond.space)) clearSplit();
        splitRatio = Math.max(.28f, Math.min(.72f, (float) state.optDouble("splitRatio", .5)));
        readPages(state.optJSONArray("closed"), closed, MAX_CLOSED);
        readPages(state.optJSONArray("bookmarks"), bookmarks, MAX_BOOKMARKS);
        readPages(state.optJSONArray("history"), history, MAX_HISTORY);
        JSONArray terms = state.optJSONArray("searches");
        if (terms != null) {
            for (int i = 0; i < Math.min(terms.length(), 30); i++) {
                JSONObject term = terms.optJSONObject(i);
                String value = (term == null ? terms.optString(i) : term.optString("text")).trim();
                String space = term == null ? DEFAULT : validSpace(term.optString("space"));
                if (!value.isEmpty() && value.length() <= 240) searches.add(new Search(value, space));
            }
        }
    }

    private String validSpace(String id) { return space(id) == null ? DEFAULT : id; }

    private String validGroup(String id, String space) {
        Group group = group(id);
        return group != null && group.space.equals(space) ? group.id : null;
    }

    Space space(String id) {
        for (Space entry : spaces) if (entry.id.equals(id)) return entry;
        return null;
    }

    Group group(String id) {
        for (Group entry : groups) if (entry.id.equals(id)) return entry;
        return null;
    }

    Space activeSpace() { return space(active.space); }


    List<Tab> currentTabs() {
        List<Tab> list = new ArrayList<>();
        for (Tab tab : tabs) if (tab.space.equals(active.space)) list.add(tab);
        return list;
    }

    Tab add(String url, String title) { return add(url, title, active.space); }

    Tab add(String url, String title, String space) {
        if (tabs.size() >= MAX_TABS) return null;
        Tab tab = new Tab(url, title, space);
        tabs.add(tab);
        active = tab;
        return tab;
    }

    Space createSpace(String name, int color) {
        if (isPrivate() || spaces.size() >= MAX_SPACES || tabs.size() >= MAX_TABS) return null;
        Space space = new Space(UUID.randomUUID().toString(), label(name, "스페이스", 40), opaque(color));
        spaces.add(space);
        return space;
    }

    Group createGroup(String name, int color) {
        if (groups.size() >= MAX_GROUPS) return null;
        Group group = new Group(UUID.randomUUID().toString(), active.space, label(name, "탭 그룹", 40), opaque(color));
        groups.add(group);
        return group;
    }

    void removeGroup(Group group) {
        if (!groups.remove(group)) return;
        for (Tab tab : tabs) if (group.id.equals(tab.group)) tab.group = null;
    }

    void close(Tab tab) {
        if (!tabs.contains(tab)) return;
        List<Tab> siblings = new ArrayList<>();
        for (Tab other : tabs) if (other.space.equals(tab.space)) siblings.add(other);
        int index = siblings.indexOf(tab);
        Tab partner = isSplitTab(tab) ? (tab == splitFirst ? splitSecond : splitFirst) : null;
        if (partner != null) clearSplit();
        if (!isPrivate() && tab.url != null) {
            closed.add(0, tab.entry());
            if (closed.size() > MAX_CLOSED) closed.remove(MAX_CLOSED);
        }
        tabs.remove(tab);
        siblings.remove(tab);
        if (active == tab) {
            if (partner != null) active = partner;
            else if (siblings.isEmpty()) add(null, null, tab.space);
            else active = siblings.get(Math.min(index, siblings.size() - 1));
        }
    }

    void setSplit(Tab first, Tab second) {
        if (first == second || !first.space.equals(second.space)) return;
        splitFirst = first;
        splitSecond = second;
        splitRatio = .5f;
    }

    boolean isSplitTab(Tab tab) {
        return tab != null && (tab == splitFirst || tab == splitSecond) && splitFirst != null && splitSecond != null;
    }

    void clearSplit() { splitFirst = splitSecond = null; }

    Tab restore(Page page) {
        if (!closed.contains(page)) return null;
        Tab tab = add(page.url, page.title, validSpace(page.space));
        if (tab != null) {
            tab.group = validGroup(page.group, tab.space);
            tab.pinned = page.pinned;
            closed.remove(page);
        }
        return tab;
    }

    boolean hasBookmark(String url) { return bookmarks.stream().anyMatch(page -> page.url.equals(url)); }

    boolean toggleBookmark(String url, String title) {
        if (bookmarks.removeIf(page -> page.url.equals(url))) return false;
        addBookmark(new Page(url, title));
        return true;
    }

    boolean addBookmark(Page page) {
        if (isPrivate() || hasBookmark(page.url) || bookmarks.size() >= MAX_BOOKMARKS) return false;
        bookmarks.add(0, page);
        return true;
    }

    void visit(Tab tab) {
        if (isPrivate() || tab.url == null || tab.url.length() > 2048) return;
        history.removeIf(page -> page.space.equals(tab.space) && page.url.equals(tab.url));
        history.add(0, tab.entry());
        if (history.size() > MAX_HISTORY) history.remove(MAX_HISTORY);
    }

    void rememberSearch(String input) {
        String text = input.trim();
        if (isPrivate() || text.isEmpty() || text.length() > 240) return;
        searches.removeIf(entry -> entry.space.equals(active.space) && entry.text.equals(text));
        searches.add(0, new Search(text, active.space));
        if (searches.size() > 30) searches.remove(30);
    }

    void save() {
        if (preferences == null) return;
        try {
            JSONArray open = new JSONArray(), spaceList = new JSONArray(), groupList = new JSONArray();
            for (Tab tab : tabs) {
                open.put(pageJson(tab.entry()).put("desktop", tab.desktop).put("zoom", tab.textZoom));
            }
            for (Space space : spaces) spaceList.put(new JSONObject().put("id", space.id)
                    .put("name", space.name).put("color", space.color));
            for (Group group : groups) groupList.put(new JSONObject().put("id", group.id).put("space", group.space)
                    .put("name", group.name).put("color", group.color).put("collapsed", group.collapsed));
            JSONArray searchList = new JSONArray();
            for (Search entry : searches) searchList.put(new JSONObject().put("text", entry.text).put("space", entry.space));
            JSONObject shortcuts = new JSONObject();
            for (Space space : spaces) {
                JSONObject panel = shortcutPanels.get(space.id);
                if (panel != null) shortcuts.put(space.id, panel);
            }
            JSONObject state = new JSONObject().put("open", open).put("active", tabs.indexOf(active))
                    .put("splitFirst", tabs.indexOf(splitFirst)).put("splitSecond", tabs.indexOf(splitSecond))
                    .put("splitRatio", splitRatio).put("spaces", spaceList).put("groups", groupList)
                    .put("closed", writePages(closed)).put("bookmarks", writePages(bookmarks))
                    .put("history", writePages(history)).put("searches", searchList).put("quickLinks", shortcuts);
            preferences.edit().putString("tabs", state.toString()).apply();
        } catch (JSONException impossible) {
            throw new AssertionError(impossible);
        }
    }

    private void readPages(JSONArray values, List<Page> pages, int max) {
        for (JSONObject value : entries(values, max)) {
            String url = WebAddress.normalize(value.optString("url", null));
            String space = validSpace(value.optString("space"));
            if (url != null) pages.add(new Page(url, value.optString("title"), space,
                    validGroup(value.optString("group"), space), value.optBoolean("pinned")));
        }
    }

    private static JSONArray writePages(List<Page> pages) throws JSONException {
        JSONArray entries = new JSONArray();
        for (Page page : pages) entries.put(pageJson(page));
        return entries;
    }

    private static JSONObject pageJson(Page page) throws JSONException {
        return new JSONObject().put("url", page.url).put("title", page.title).put("space", page.space)
                .put("group", page.group).put("pinned", page.pinned);
    }

    private static List<JSONObject> entries(JSONArray array, int max) {
        List<JSONObject> values = new ArrayList<>();
        if (array != null) for (int i = 0; i < Math.min(array.length(), max); i++) {
            JSONObject item = array.optJSONObject(i);
            if (item != null) values.add(item);
        }
        return values;
    }

    static String label(String input, String fallback, int max) {
        String value = input == null ? "" : input.trim();
        return value.isEmpty() ? fallback : value.substring(0, Math.min(value.length(), max));
    }

    private static int opaque(int color) { return color | 0xff000000; }
    private static boolean validId(String id) { return id.matches("[0-9a-f-]{36}"); }
}

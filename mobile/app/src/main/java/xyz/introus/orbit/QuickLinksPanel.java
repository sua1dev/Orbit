package xyz.introus.orbit;

import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

import static android.view.ViewGroup.LayoutParams.WRAP_CONTENT;
import static xyz.introus.orbit.OrbitIcon.Kind;

final class QuickLinksPanel {
    private final BrowserChrome chrome;
    private final BrowserActivity activity;
    private final QuickLinks data;
    private final LinearLayout root;
    private final Runnable returnToTabs;
    private boolean editing;

    QuickLinksPanel(BrowserChrome chrome, Runnable returnToTabs) {
        this.chrome = chrome;
        activity = chrome.activity;
        data = activity.store.quickLinks();
        this.returnToTabs = returnToTabs;
        root = chrome.column();
        root.setPadding(chrome.dp(10), chrome.dp(5), chrome.dp(10), chrome.dp(9));
        root.setBackground(chrome.shape(chrome.card, chrome.radius(20), chrome.line));
        draw();
    }

    View view() { return root; }

    private void draw() {
        root.removeAllViews();
        LinearLayout header = chrome.row();
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView label = chrome.text("바로가기", 15, chrome.ink, true);
        label.setAccessibilityHeading(true);
        header.addView(label, new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        TextView edit = chrome.action(editing ? "완료" : "편집", chrome.soft, chrome.ink, () -> {
            editing = !editing;
            draw();
        });
        edit.setSelected(editing);
        header.addView(edit);
        root.addView(header);

        String density = activity.preferences.getString("dialSize", "medium");
        int height = density.equals("small") ? 48 : density.equals("large") ? 61 : 53;
        LinearLayout line = null;
        for (int i = 0; i < QuickLinks.SLOTS; i++) {
            if (i % 3 == 0) { line = chrome.row(); chrome.addTop(root, line, 5); }
            int slot = i;
            QuickLinks.Item item = data.slots[i];
            LinearLayout tile = chrome.row();
            tile.setGravity(Gravity.CENTER);
            tile.setBackground(chrome.actionSurface(chrome.soft, 13));
            tile.setContentDescription(item == null ? (i + 1) + "번 바로가기 추가" : item.title);
            tile.addView(item == null ? chrome.glyph(Kind.PLUS, chrome.muted, 23) : chrome.favicon(item.url),
                    new LinearLayout.LayoutParams(chrome.dp(25), chrome.dp(25)));
            tile.setOnClickListener(view -> {
                if (item == null || editing) editor(slot, null, item, false);
                else activity.open(item.url, returnToTabs != null);
            });
            if (item != null) tile.setOnLongClickListener(view -> { editor(slot, null, item, false); return true; });
            LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(0, chrome.dp(height), 1);
            if (i % 3 != 0) size.setMarginStart(chrome.dp(5));
            line.addView(tile, size);
        }

        for (QuickLinks.Item item : data.rows) {
            if (item.links == null) chrome.addTop(root, link(item, null), 5);
            else chrome.addTop(root, folder(item), 5);
        }

        LinearLayout controls = chrome.row();
        controls.addView(chrome.option(Kind.PLUS, "링크 추가", () -> editor(-1, null, null, false)),
                new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        controls.addView(chrome.option(Kind.FOLDER, "폴더 추가", () -> editor(-1, null, null, true)),
                new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        chrome.addTop(root, controls, 4);
    }

    private View link(QuickLinks.Item item, QuickLinks.Item parent) {
        LinearLayout row = chrome.row();
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(chrome.dp(48));
        row.setPadding(chrome.dp(9), 0, chrome.dp(9), 0);
        row.setBackground(chrome.actionSurface(chrome.soft, 11));
        ImageView icon = chrome.favicon(item.url);
        row.addView(icon, new LinearLayout.LayoutParams(chrome.dp(22), chrome.dp(22)));
        TextView name = chrome.oneLine(item.title, 15, chrome.ink, false);
        name.setPadding(chrome.dp(8), 0, 0, 0);
        row.addView(name, new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        row.setContentDescription(item.title);
        row.setOnClickListener(view -> {
            if (editing) editor(-1, parent, item, false);
            else activity.open(item.url, returnToTabs != null);
        });
        row.setOnLongClickListener(view -> { editor(-1, parent, item, false); return true; });
        return row;
    }

    private View folder(QuickLinks.Item item) {
        LinearLayout group = chrome.column();
        group.setBackground(chrome.shape(chrome.card, chrome.radius(11), chrome.line));
        LinearLayout toggle = chrome.option(Kind.FOLDER, item.title, () -> {
            if (editing) editor(-1, null, item, true);
            else {
                item.open = !item.open;
                activity.store.save();
                draw();
            }
        });
        toggle.addView(chrome.text(item.open ? "⌄" : "›", 19, chrome.muted, true));
        toggle.setContentDescription(item.title + (item.open ? ", 펼쳐짐" : ", 접힘"));
        toggle.setOnLongClickListener(view -> { editor(-1, null, item, true); return true; });
        group.addView(toggle);
        if (item.open) {
            LinearLayout children = chrome.column();
            children.setPadding(chrome.dp(11), 0, chrome.dp(6), chrome.dp(4));
            for (QuickLinks.Item child : item.links) chrome.addTop(children, link(child, item), 4);
            children.addView(chrome.option(Kind.PLUS, "폴더에 링크 추가", () -> editor(-1, item, null, false)));
            group.addView(children);
        }
        return group;
    }

    private void editor(int slot, QuickLinks.Item parent, QuickLinks.Item item, boolean folder) {
        LinearLayout sheet = chrome.openPanel("quick-link-edit",
                folder ? (item == null ? "바로가기 폴더 추가" : "폴더 편집") : (item == null ? "바로가기 추가" : "바로가기 편집"));
        EditText title = chrome.edit("이름", false);
        title.setText(item == null ? "" : item.title);
        chrome.addTop(sheet, title, 7);
        EditText address = folder ? null : chrome.edit("웹 주소", true);
        if (address != null) {
            address.setText(item == null ? "" : item.url);
            chrome.addTop(sheet, address, 8);
        }
        List<QuickLinks.Item> list = parent == null ? data.rows : parent.links;
        chrome.addTop(sheet, chrome.action("저장", chrome.accent, chrome.onAccent, () -> {
            String url = address == null ? null : QuickLinks.address(address.getText().toString());
            if (address != null && url == null) { activity.toast("올바른 HTTP 또는 HTTPS 주소를 입력해 주세요."); return; }
            String name = TabStore.label(title.getText().toString(), folder ? "" : WebAddress.displayHost(url), 100);
            if (name.isEmpty()) { activity.toast("폴더 이름을 입력해 주세요."); return; }
            if (item != null) {
                item.title = name;
                item.url = url;
            } else if (slot >= 0) data.slots[slot] = new QuickLinks.Item(name, url);
            else {
                if (list.size() >= (parent == null ? QuickLinks.ROW_LIMIT : QuickLinks.FOLDER_LIMIT)) {
                    activity.toast("저장할 수 있는 항목 수에 도달했어요.");
                    return;
                }
                list.add(new QuickLinks.Item(name, url));
            }
            finishEdit();
        }), 10);
        if (item != null) chrome.addTop(sheet, chrome.action(folder && !item.links.isEmpty() ? "폴더와 안의 링크 삭제" : "삭제",
                chrome.soft, chrome.ink, () -> {
                    if (slot >= 0) data.slots[slot] = null; else list.remove(item);
                    finishEdit();
                }), 6);
    }

    private void finishEdit() {
        activity.store.save();
        if (returnToTabs != null) returnToTabs.run();
        else { chrome.dismissPanel(); draw(); }
    }
}

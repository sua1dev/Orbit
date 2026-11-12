package xyz.introus.orbit;

import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

import static android.view.ViewGroup.LayoutParams.MATCH_PARENT;
import static android.view.ViewGroup.LayoutParams.WRAP_CONTENT;

final class StartPage {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm", Locale.KOREAN);
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("M월 d일 EEEE", Locale.KOREAN);
    private static final String[][] SHORTCUTS = {
        {"Google", "https://www.google.com/", "google"},
        {"네이버", "https://www.naver.com/", "naver"},
        {"YouTube", "https://www.youtube.com/", "youtube"},
        {"Discord", "https://discord.com/app", "discord"},
    };

    private final BrowserChrome chrome;
    private final BrowserActivity activity;
    private ImageView wallpaper;
    private TextView date;
    private TextView clock;
    private String shownScene;

    StartPage(BrowserChrome chrome) {
        this.chrome = chrome;
        activity = chrome.activity;
    }

    static String scene(BrowserActivity activity) {
        String picked = activity.preferences.getString("scene", "auto");
        switch (picked) {
            case "day":
            case "night":
            case "rain":
            case "snow":
                return picked;
            default:
                int hour = ZonedDateTime.now(SEOUL).getHour();
                return hour >= 6 && hour < 18 ? "day" : "night";
        }
    }

    View build() {
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setVerticalScrollBarEnabled(false);
        FrameLayout aligned = new FrameLayout(activity);
        int available = activity.getResources().getConfiguration().screenWidthDp;
        int width = available > 600 ? chrome.dp(540) : MATCH_PARENT;
        LinearLayout inner = chrome.column();
        inner.setPadding(chrome.dp(20), chrome.dp(16), chrome.dp(20), chrome.dp(16));
        FrameLayout.LayoutParams area = new FrameLayout.LayoutParams(width, WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        aligned.addView(inner, area);
        scroll.addView(aligned);

        LinearLayout brand = chrome.row();
        brand.setGravity(Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(activity);
        mark.setImageBitmap(chrome.image("orbit.png"));
        brand.addView(mark, new LinearLayout.LayoutParams(chrome.dp(32), chrome.dp(32)));
        TextView name = chrome.text("Orbit", 23, chrome.ink, true);
        name.setLetterSpacing(-.045f);
        name.setPadding(chrome.dp(8), 0, 0, 0);
        brand.addView(name);
        inner.addView(brand);

        TextView title = chrome.text("오늘의 궤도", 35, chrome.ink, true);
        title.setAccessibilityHeading(true);
        title.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        title.setLetterSpacing(-.067f);
        chrome.addTop(inner, title, 14);
        int heroHeight = activity.getResources().getConfiguration().screenHeightDp < 500 ? 180 : 237;
        LinearLayout.LayoutParams heroSize = new LinearLayout.LayoutParams(MATCH_PARENT, chrome.dp(heroHeight));
        heroSize.topMargin = chrome.dp(12);
        inner.addView(hero(), heroSize);

        LinearLayout shortcuts = chrome.row();
        for (String[] entry : SHORTCUTS) {
            LinearLayout tile = chrome.column();
            tile.setGravity(Gravity.CENTER);
            tile.setBackground(chrome.actionSurface(chrome.card, 16));
            tile.setContentDescription(entry[0] + " 열기");
            tile.setOnClickListener(view -> activity.open(entry[1], false));
            ImageView icon = new ImageView(activity);
            icon.setImageBitmap(chrome.image("sites/" + entry[2] + ".png"));
            icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
            tile.addView(icon, new LinearLayout.LayoutParams(chrome.dp(23), chrome.dp(23)));
            TextView caption = chrome.oneLine(entry[0], 11, chrome.ink, true);
            caption.setGravity(Gravity.CENTER);
            chrome.addTop(tile, caption, 4);
            LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(0, chrome.dp(66), 1);
            if (shortcuts.getChildCount() != 0) size.setMarginStart(chrome.dp(7));
            shortcuts.addView(tile, size);
        }
        TextView shortcutsTitle = chrome.text("바로가기", 15, chrome.ink, true);
        shortcutsTitle.setAccessibilityHeading(true);
        chrome.addTop(inner, shortcutsTitle, 18);
        chrome.addTop(inner, shortcuts, 7);

        if (!activity.store.bookmarks.isEmpty()) {
            TextView heading = chrome.text("즐겨찾기", 17, chrome.ink, true);
            heading.setAccessibilityHeading(true);
            chrome.addTop(inner, heading, 20);
            LinearLayout bookmarkList = chrome.column();
            bookmarkList.setBackground(chrome.shape(chrome.card, 16, chrome.line));
            for (TabStore.Page entry : activity.store.bookmarks) {
                View bookmark = chrome.option(OrbitIcon.Kind.STAR, entry.title, () -> activity.open(entry.url, false));
                bookmark.setOnLongClickListener(view -> {
                    new AlertDialog.Builder(activity).setTitle(entry.title)
                            .setItems(new String[]{"새 탭에서 열기", "즐겨찾기에서 제거"}, (dialog, item) -> {
                                if (item == 0) activity.open(entry.url, true);
                                else activity.removeBookmark(entry);
                            }).show();
                    return true;
                });
                bookmarkList.addView(bookmark);
            }
            chrome.addTop(inner, bookmarkList, 7);
        }
        return scroll;
    }

    private View hero() {
        FrameLayout hero = new FrameLayout(activity);
        hero.setBackground(chrome.shape(0xff282244, 23, 0));
        hero.setClipToOutline(true);
        wallpaper = new ImageView(activity);
        wallpaper.setScaleType(ImageView.ScaleType.CENTER_CROP);
        wallpaper.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        hero.addView(wallpaper, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));

        View shade = new View(activity);
        shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x080f1328, 0x180d1125, 0xdd100c26}));
        hero.addView(shade, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));

        TextView location = chrome.text("서울 · 남산", 12, Color.WHITE, true);
        location.setPadding(chrome.dp(9), chrome.dp(5), chrome.dp(9), chrome.dp(5));
        location.setBackground(chrome.shape(0xa5141531, 9, 0x38ffffff));
        FrameLayout.LayoutParams locationSize = new FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.TOP | Gravity.END);
        locationSize.setMargins(chrome.dp(12), chrome.dp(12), chrome.dp(12), 0);
        hero.addView(location, locationSize);

        LinearLayout time = chrome.column();
        date = chrome.text("", 13, 0xfff3e9ff, true);
        time.addView(date);
        clock = chrome.text("", 58, Color.WHITE, true);
        clock.setIncludeFontPadding(false);
        clock.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        clock.setLetterSpacing(-.065f);
        clock.setFontFeatureSettings("tnum");
        time.addView(clock);
        FrameLayout.LayoutParams timeSize = new FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM);
        timeSize.setMargins(chrome.dp(17), 0, chrome.dp(17), chrome.dp(14));
        hero.addView(time, timeSize);
        refresh();
        return hero;
    }

    void refresh() {
        String current = scene(activity);
        if (!current.equals(shownScene)) {
            wallpaper.setImageBitmap(chrome.image("wallpapers/seoul-" + current + ".jpg"));
            shownScene = current;
        }
        ZonedDateTime now = ZonedDateTime.now(SEOUL);
        date.setText(DATE.format(now));
        String time = TIME.format(now);
        clock.setText(time);
        clock.getPaint().setShader(new LinearGradient(0, 0, clock.getPaint().measureText(time), 0,
                new int[]{0xffffc9ee, 0xffd4c3ff, 0xff9feaff}, null, Shader.TileMode.CLAMP));
        clock.setContentDescription("서울 시각 " + time);
    }
}

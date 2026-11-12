package xyz.introus.orbit;

import android.animation.ValueAnimator;
import android.app.AlertDialog;
import android.content.Context;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import static android.view.ViewGroup.LayoutParams.MATCH_PARENT;
import static android.view.ViewGroup.LayoutParams.WRAP_CONTENT;
import static xyz.introus.orbit.OrbitIcon.Kind;

final class BrowserChrome {
    final BrowserActivity activity;
    final FrameLayout content;
    private final FrameLayout overlays;
    private final LinearLayout root;
    private final LinearLayout controls;
    private final SwipeBar bar;
    private final ProgressBar progress;
    private final TextView address;
    private final TextView tabButton;
    private final ImageButton more;
    private final Map<String, Bitmap> images = new HashMap<>();
    private View panel;
    private EditText searchInput;
    private TextView panelTitle;
    private StartPage home;
    private String panelName;
    private boolean dark;
    int paper, ink, muted, line, card, accent, onAccent, soft;

    private final Runnable homeClock = new Runnable() {
        @Override public void run() {
            if (home != null) home.refresh();
            root.postDelayed(this, 60_000 - System.currentTimeMillis() % 60_000);
        }
    };

    BrowserChrome(BrowserActivity activity) {
        this.activity = activity;
        root = column();
        root.setFocusableInTouchMode(true);
        FrameLayout stage = new FrameLayout(activity);
        content = new FrameLayout(activity);
        overlays = new FrameLayout(activity);
        overlays.setVisibility(View.GONE);
        stage.addView(content, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        stage.addView(overlays, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        root.addView(stage, new LinearLayout.LayoutParams(MATCH_PARENT, 0, 1));

        controls = column();
        progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        controls.addView(progress, new LinearLayout.LayoutParams(MATCH_PARENT, dp(3)));
        bar = new SwipeBar();
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(9), dp(6), dp(9), dp(7));
        tabButton = text("", 15, Color.BLACK, true);
        tabButton.setGravity(Gravity.CENTER);
        tabButton.setOnClickListener(view -> showTabs());
        tabButton.setOnLongClickListener(view -> { activity.newTab(); return true; });
        tabButton.setTooltipText("탭 전환 · 길게 눌러 새 탭");
        bar.addView(tabButton, new LinearLayout.LayoutParams(dp(48), dp(48)));
        address = text("", 15, Color.BLACK, true);
        address.setSingleLine();
        address.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        address.setGravity(Gravity.CENTER_VERTICAL);
        address.setPadding(dp(14), 0, dp(14), 0);
        address.setCompoundDrawablePadding(dp(9));
        address.setOnClickListener(view -> showSearch(false));
        LinearLayout.LayoutParams addressSize = new LinearLayout.LayoutParams(0, dp(48), 1);
        addressSize.setMargins(dp(6), 0, dp(6), 0);
        bar.addView(address, addressSize);
        more = iconButton(Kind.MORE, "브라우저 메뉴", () -> showMenu());
        bar.addView(more, new LinearLayout.LayoutParams(dp(48), dp(48)));
        controls.addView(bar);
        root.addView(controls);

        activity.setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            activity.getWindow().setDecorFitsSystemWindows(false);
            activity.getWindow().setStatusBarColor(Color.TRANSPARENT);
            activity.getWindow().setNavigationBarColor(Color.TRANSPARENT);
            activity.getWindow().setNavigationBarContrastEnforced(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, ime.bottom));
                return insets;
            });
            root.requestApplyInsets();
        }
        updateTheme();
    }

    void updateTheme() {
        String mode = activity.preferences.getString("theme", "system");
        dark = mode.equals("dark") || (mode.equals("system") &&
                (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                        == Configuration.UI_MODE_NIGHT_YES);
        paper = dark ? 0xff1c1923 : 0xfff8f5f2;
        card = dark ? 0xff282333 : 0xfffffdfd;
        ink = dark ? 0xfff8f1fb : 0xff251f2d;
        muted = dark ? 0xffc5bacf : 0xff62586d;
        line = dark ? 0xff3f364b : 0xffe6dde7;
        accent = dark ? 0xffc6b6ff : 0xff51419a;
        onAccent = dark ? 0xff241b47 : Color.WHITE;
        soft = dark ? 0xff36304a : 0xffeee8f6;
        root.setBackgroundColor(paper);
        content.setBackgroundColor(paper);
        controls.setBackgroundColor(paper);
        tabButton.setTextColor(ink);
        tabButton.setBackground(actionSurface(card, 16));
        address.setTextColor(ink);
        address.setBackground(actionSurface(soft, 18));
        more.setImageDrawable(icon(Kind.MORE, ink, 24));
        more.setBackground(actionSurface(card, 16));
        progress.setProgressTintList(ColorStateList.valueOf(accent));
        progress.setProgressBackgroundTintList(ColorStateList.valueOf(paper));
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = activity.getWindow().getInsetsController();
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (controller != null) controller.setSystemBarsAppearance(dark ? 0 : light, light);
        } else {
            activity.getWindow().setStatusBarColor(paper);
            activity.getWindow().setNavigationBarColor(paper);
            activity.getWindow().getDecorView().setSystemUiVisibility(dark ? 0 :
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    void resume() { root.removeCallbacks(homeClock); homeClock.run(); }
    void pause() { root.removeCallbacks(homeClock); }

    void present(TabStore.Tab tab, BrowserPage page) {
        if (page != null && page.error == null && page.getParent() == content && content.getChildCount() == 1) {
            updateBar(tab, page);
            return;
        }
        content.removeAllViews();
        home = null;
        if (tab.url == null) {
            home = new StartPage(this);
            content.addView(home.build(), new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        } else if (page == null || page.error != null) {
            showError(page == null ? "페이지를 다시 열어 주세요." : page.error);
        } else {
            if (page.getParent() instanceof ViewGroup) ((ViewGroup) page.getParent()).removeView(page);
            content.addView(page, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        }
        updateBar(tab, page);
    }

    void showCrash(TabStore.Tab tab) {
        content.removeAllViews();
        showError("웹페이지가 멈췄어요. 다시 열어 주세요.");
        updateBar(tab, null);
    }

    private void showError(String message) {
        LinearLayout box = column();
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(24), dp(24), dp(24), dp(24));
        box.addView(glyph(Kind.GLOBE, accent, 32));
        TextView title = text("페이지를 열 수 없어요", 25, ink, true);
        title.setGravity(Gravity.CENTER);
        addTop(box, title, 16);
        TextView detail = text(message, 15, muted, false);
        detail.setGravity(Gravity.CENTER);
        addTop(box, detail, 9);
        addTop(box, action("다시 시도", accent, onAccent, activity::reload), 18);
        content.addView(box, new FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.CENTER));
    }

    void updateBar(TabStore.Tab tab, BrowserPage page) {
        boolean home = tab.url == null;
        boolean http = !home && tab.url.startsWith("http://");
        boolean secure = !home && !http && page != null && page.progress == 100 && page.error == null;
        String host = WebAddress.displayHost(tab.url);
        address.setText(home ? "검색 또는 웹 주소" : http ? "HTTP · " + host : host);
        address.setContentDescription(home ? "검색 또는 웹 주소 입력" : "주소 입력, " + tab.url);
        Drawable symbol = icon(home ? Kind.SEARCH : secure ? Kind.LOCK : Kind.GLOBE, muted, 18);
        symbol.setBounds(0, 0, dp(18), dp(18));
        address.setCompoundDrawablesRelative(symbol, null, null, null);
        tabButton.setText(String.valueOf(activity.store.tabs.size()));
        tabButton.setContentDescription("탭 전환, " + activity.store.tabs.size() + "개 열림");
        boolean loading = page != null && page.progress < 100;
        progress.setVisibility(loading ? View.VISIBLE : View.INVISIBLE);
        progress.setProgress(loading ? page.progress : 0);
    }

    void showSearch(boolean blank) {
        LinearLayout sheet = openPanel("search", "주소와 검색");
        controls.setVisibility(View.GONE);
        EditText input = edit("검색어 또는 웹 주소", true);
        searchInput = input;
        input.setImeOptions(EditorInfo.IME_ACTION_GO | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        String current = blank ? "" : activity.store.active.url;
        input.setText(current == null ? "" : current);
        addTop(sheet, input, 14);
        LinearLayout suggestions = column();
        addTop(sheet, suggestions, 10);
        Runnable refresh = () -> {
            suggestions.removeAllViews();
            String query = input.getText().toString().trim();
            if (query.isEmpty()) {
                suggestions.addView(text(activity.searchEngine().label + "에서 검색", 14, muted, false));
                return;
            }
            suggestions.addView(option(Kind.SEARCH, "입력한 주소 열기 또는 검색", () -> activity.search(query)));
            String needle = query.toLowerCase(Locale.ROOT);
            int count = 0;
            for (TabStore.Tab tab : activity.store.tabs) {
                if (tab == activity.store.active || tab.url == null || count == 2) continue;
                if ((tab.label() + " " + tab.url).toLowerCase(Locale.ROOT).contains(needle)) {
                    suggestions.addView(option(Kind.TABS, tab.label(), () -> activity.select(tab)));
                    count++;
                }
            }
        };
        watch(input, refresh);
        refresh.run();
        input.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_GO &&
                    (event == null || event.getKeyCode() != KeyEvent.KEYCODE_ENTER || event.getAction() != KeyEvent.ACTION_DOWN)) return false;
            activity.search(input.getText().toString());
            return true;
        });
        input.requestFocus();
        input.selectAll();
        input.post(() -> {
            if (searchInput == input && input.isAttachedToWindow()) {
                activity.getSystemService(InputMethodManager.class).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
            }
        });
    }

    void showTabs() {
        activity.savePreview();
        LinearLayout sheet = openPanel("tabs", "탭 · " + activity.store.tabs.size());
        LinearLayout buttons = row();
        buttons.setGravity(Gravity.CENTER_VERTICAL);
        EditText filter = edit("탭 제목 또는 주소로 찾기", false);
        buttons.addView(filter, new LinearLayout.LayoutParams(0, dp(48), 1));
        ImageButton add = iconButton(Kind.PLUS, "새 탭 추가", activity::newTab);
        add.setBackground(actionSurface(soft, 16));
        LinearLayout.LayoutParams addSize = new LinearLayout.LayoutParams(dp(48), dp(48));
        addSize.setMarginStart(dp(8));
        buttons.addView(add, addSize);
        addTop(sheet, buttons, 14);

        HorizontalScrollView deck = new HorizontalScrollView(activity);
        deck.setHorizontalScrollBarEnabled(false);
        deck.setClipToPadding(false);
        LinearLayout cards = row();
        deck.addView(cards);
        addTop(sheet, deck, 12);
        LinearLayout recent = column();
        addTop(sheet, recent, 10);
        Runnable draw = () -> drawTabs(cards, recent, filter.getText().toString());
        watch(filter, draw);
        draw.run();
        int index = activity.store.tabs.indexOf(activity.store.active);
        deck.post(() -> {
            if (index >= 0 && index < cards.getChildCount()) {
                deck.scrollTo(Math.max(0, cards.getChildAt(index).getLeft() - dp(10)), 0);
            }
        });
    }

    private void drawTabs(LinearLayout cards, LinearLayout recent, String rawFilter) {
        if (panelTitle != null) panelTitle.setText("탭 · " + activity.store.tabs.size());
        String filter = rawFilter.trim().toLowerCase(Locale.ROOT);
        cards.removeAllViews();
        recent.removeAllViews();
        int width = Math.max(170, Math.min(255, activity.getResources().getConfiguration().screenWidthDp - 92));
        for (TabStore.Tab tab : activity.store.tabs) {
            String details = tab.label() + " " + (tab.url == null ? "" : tab.url);
            if (!details.toLowerCase(Locale.ROOT).contains(filter)) continue;
            FrameLayout tile = new FrameLayout(activity);
            LinearLayout open = column();
            open.setBackground(actionSurface(tab == activity.store.active ? soft : card, 18));
            open.setClipToOutline(true);
            open.setOnClickListener(view -> activity.select(tab));
            open.setContentDescription(tab.label() + (tab == activity.store.active ? ", 현재 탭" : ", 열기"));
            Bitmap preview = activity.previewFor(tab);
            if (preview == null && tab.url == null) preview = image("wallpapers/seoul-" + StartPage.scene(activity) + ".jpg");
            if (preview != null) {
                ImageView image = new ImageView(activity);
                image.setImageBitmap(preview);
                image.setScaleType(ImageView.ScaleType.CENTER_CROP);
                open.addView(image, new LinearLayout.LayoutParams(MATCH_PARENT, dp(112)));
            } else {
                FrameLayout empty = new FrameLayout(activity);
                empty.setBackgroundColor(soft);
                BrowserPage page = activity.pageFor(tab);
                if (page != null && page.favicon != null) {
                    ImageView site = new ImageView(activity);
                    site.setImageBitmap(page.favicon);
                    empty.addView(site, new FrameLayout.LayoutParams(dp(34), dp(34), Gravity.CENTER));
                } else {
                    empty.addView(glyph(Kind.GLOBE, accent, 34), new FrameLayout.LayoutParams(dp(34), dp(34), Gravity.CENTER));
                }
                open.addView(empty, new LinearLayout.LayoutParams(MATCH_PARENT, dp(112)));
            }
            LinearLayout labels = column();
            labels.setPadding(dp(12), dp(10), dp(12), dp(11));
            labels.addView(oneLine(tab.label(), 15, ink, true));
            addTop(labels, oneLine(tab.url == null ? "Orbit 시작 페이지" : WebAddress.displayHost(tab.url), 12, muted, false), 4);
            open.addView(labels);
            tile.addView(open, new FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT));
            ImageButton close = iconButton(Kind.CLOSE, tab.label() + " 닫기", () -> {
                activity.close(tab);
                drawTabs(cards, recent, rawFilter);
            });
            close.setBackground(actionSurface(card, 18));
            FrameLayout.LayoutParams closeSize = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.END | Gravity.TOP);
            closeSize.setMargins(0, dp(5), dp(5), 0);
            tile.addView(close, closeSize);
            LinearLayout.LayoutParams cardSize = new LinearLayout.LayoutParams(dp(width), WRAP_CONTENT);
            cardSize.setMarginEnd(dp(9));
            cards.addView(tile, cardSize);
        }
        if (cards.getChildCount() == 0) {
            TextView empty = text("일치하는 열린 탭이 없어요.", 14, muted, false);
            empty.setPadding(dp(2), dp(14), 0, dp(14));
            cards.addView(empty);
        }
        int shown = 0;
        for (TabStore.Page entry : activity.store.closed) {
            if (!(entry.title + " " + entry.url).toLowerCase(Locale.ROOT).contains(filter)) continue;
            if (shown++ == 0) addTop(recent, text("최근 닫은 탭", 14, muted, true), 6);
            recent.addView(option(Kind.RELOAD, entry.title, () -> activity.restore(entry)));
        }
    }

    private void showMenu() {
        LinearLayout sheet = openPanel("menu", "Orbit");
        TabStore.Tab tab = activity.store.active;
        BrowserPage page = activity.activePage();
        if (tab.url != null) {
            addTop(sheet, oneLine(WebAddress.displayHost(tab.url), 14, muted, false), 6);
            LinearLayout navigation = row();
            navigation.setGravity(Gravity.CENTER_VERTICAL);
            ImageButton back = iconButton(Kind.BACK, "뒤로", activity::goBack);
            back.setEnabled(page != null && page.canGoBack());
            ImageButton forward = iconButton(Kind.FORWARD, "앞으로", activity::goForward);
            forward.setEnabled(page != null && page.canGoForward());
            navigation.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
            navigation.addView(forward, new LinearLayout.LayoutParams(dp(48), dp(48)));
            navigation.addView(iconButton(Kind.RELOAD, "새로고침", () -> { dismissPanel(); activity.reload(); }),
                    new LinearLayout.LayoutParams(dp(48), dp(48)));
            back.setOnClickListener(view -> { dismissPanel(); activity.goBack(); });
            forward.setOnClickListener(view -> { dismissPanel(); activity.goForward(); });
            addTop(sheet, navigation, 8);
            sheet.addView(option(Kind.STAR, activity.store.hasBookmark(tab.url) ? "즐겨찾기에서 제거" : "즐겨찾기에 추가",
                    () -> { dismissPanel(); activity.toggleBookmark(); }));
            sheet.addView(option(Kind.SHARE, "페이지 공유", () -> { dismissPanel(); activity.share(tab.url); }));
            sheet.addView(option(Kind.GLOBE, "주소 복사", () -> { dismissPanel(); activity.copy(tab.url); }));
        }
        sheet.addView(option(Kind.PLUS, "새 탭", activity::newTab));
        sheet.addView(option(Kind.TABS, "탭 전환", this::showTabs));
        sheet.addView(option(Kind.SETTINGS, "설정", this::showSettings));
    }

    private void showSettings() {
        LinearLayout sheet = openPanel("settings", "설정");
        WebAddress.SearchEngine[] engines = WebAddress.SearchEngine.values();
        String[] names = new String[engines.length];
        for (int index = 0; index < names.length; index++) names[index] = engines[index].label;
        addTop(sheet, option(Kind.SEARCH, "검색 엔진 · " + activity.searchEngine().label,
                () -> choose("검색 엔진", names, activity.searchEngine().ordinal(), index -> {
                    activity.preferences.edit().putString("engine", engines[index].name()).apply();
                    showSettings();
                })), 10);
        String[] themes = {"system", "light", "dark"};
        String[] themeLabels = {"시스템 설정", "밝게", "어둡게"};
        int selectedTheme = position(themes, activity.preferences.getString("theme", "system"));
        sheet.addView(option(Kind.SETTINGS, "테마 · " + themeLabels[selectedTheme],
                () -> choose("테마", themeLabels, selectedTheme, index -> {
                    activity.preferences.edit().putString("theme", themes[index]).apply();
                    updateTheme();
                    present(activity.store.active, activity.activePage());
                    showSettings();
                })));
        String[] scenes = {"auto", "day", "night", "rain", "snow"};
        String[] sceneLabels = {"서울 시각에 따라", "낮", "밤", "비", "눈"};
        int selectedScene = position(scenes, activity.preferences.getString("scene", "auto"));
        sheet.addView(option(Kind.HOME, "시작 페이지 배경 · " + sceneLabels[selectedScene],
                () -> choose("시작 페이지 배경", sceneLabels, selectedScene, index -> {
                    activity.preferences.edit().putString("scene", scenes[index]).apply();
                    if (activity.store.active.url == null) present(activity.store.active, null);
                    showSettings();
                })));
        addTop(sheet, text("Orbit Mobile " + BuildConfig.VERSION_NAME, 13, muted, false), 16);
    }

    private void choose(String title, String[] values, int selected, java.util.function.IntConsumer change) {
        int theme = dark ? android.R.style.Theme_Material_Dialog_Alert : android.R.style.Theme_Material_Light_Dialog_Alert;
        new AlertDialog.Builder(activity, theme).setTitle(title)
                .setSingleChoiceItems(values, selected, (dialog, option) -> {
                    dialog.dismiss();
                    change.accept(option);
                }).setNegativeButton("닫기", null).show();
    }

    private int position(String[] values, String value) {
        for (int index = 0; index < values.length; index++) if (values[index].equals(value)) return index;
        return 0;
    }

    private LinearLayout openPanel(String kind, String title) {
        dismissPanel();
        View focused = activity.getCurrentFocus();
        if (focused != null && focused != root) {
            activity.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(focused.getWindowToken(), 0);
            root.requestFocus();
        }
        panelName = kind;
        FrameLayout layer = new FrameLayout(activity);
        layer.setBackgroundColor(0x520e091b);
        layer.setOnClickListener(view -> dismissPanel());
        overlays.setVisibility(View.VISIBLE);
        overlays.addView(layer, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        panel = layer;
        content.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        ScrollView scroll = new ScrollView(activity);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setBackground(shape(card, 24, line));
        scroll.setClickable(true);
        scroll.setElevation(dp(8));
        FrameLayout.LayoutParams size = new FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM);
        size.setMargins(dp(8), dp(10), dp(8), dp(8));
        layer.addView(scroll, size);
        LinearLayout sheet = column();
        sheet.setPadding(dp(16), dp(10), dp(16), dp(15));
        scroll.addView(sheet);
        LinearLayout header = row();
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView heading = text(title, 22, ink, true);
        panelTitle = heading;
        heading.setAccessibilityHeading(true);
        header.addView(heading, new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        header.addView(iconButton(Kind.CLOSE, "닫기", this::dismissPanel),
                new LinearLayout.LayoutParams(dp(48), dp(48)));
        sheet.addView(header);
        if (ValueAnimator.areAnimatorsEnabled()) {
            scroll.setTranslationY(dp(12));
            scroll.setAlpha(0f);
            scroll.animate().translationY(0).alpha(1f).setDuration(180).start();
        }
        return sheet;
    }

    boolean dismissPanel() {
        if (panel == null) return false;
        View focused = activity.getCurrentFocus();
        if (focused instanceof EditText) {
            activity.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(focused.getWindowToken(), 0);
            focused.clearFocus();
        }
        searchInput = null;
        panel = null;
        panelName = null;
        panelTitle = null;
        overlays.removeAllViews();
        overlays.setVisibility(View.GONE);
        controls.setVisibility(View.VISIBLE);
        content.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        root.requestFocus();
        return true;
    }

    Bitmap image(String name) {
        if (!images.containsKey(name)) {
            try (InputStream asset = activity.getAssets().open(name)) {
                BitmapFactory.Options options = new BitmapFactory.Options();
                if (name.startsWith("wallpapers/")) options.inSampleSize = 2;
                images.put(name, BitmapFactory.decodeStream(asset, null, options));
            } catch (IOException unavailable) {
                images.put(name, null);
            }
        }
        return images.get(name);
    }

    LinearLayout column() { LinearLayout view = new LinearLayout(activity); view.setOrientation(LinearLayout.VERTICAL); return view; }
    LinearLayout row() { return new LinearLayout(activity); }
    int dp(float value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }

    TextView text(String label, float size, int color, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(label);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return view;
    }

    TextView oneLine(String label, float size, int color, boolean bold) {
        TextView view = text(label, size, color, bold);
        view.setSingleLine();
        view.setEllipsize(TextUtils.TruncateAt.END);
        return view;
    }

    void addTop(LinearLayout parent, View child, int margin) {
        LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT);
        size.topMargin = dp(margin);
        parent.addView(child, size);
    }

    Drawable shape(int fill, int radius, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        if (stroke != 0) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    Drawable actionSurface(int fill, int radius) {
        return new RippleDrawable(ColorStateList.valueOf(dark ? 0x30ffffff : 0x2251419a),
                shape(fill, radius, 0), shape(Color.WHITE, radius, 0));
    }

    OrbitIcon icon(Kind kind, int color, int size) { return new OrbitIcon(kind, color, dp(size)); }

    ImageView glyph(Kind kind, int color, int size) {
        ImageView image = new ImageView(activity);
        image.setImageDrawable(icon(kind, color, size));
        image.setScaleType(ImageView.ScaleType.CENTER);
        image.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        return image;
    }

    ImageButton iconButton(Kind kind, String label, Runnable run) {
        ImageButton button = new ImageButton(activity);
        button.setImageDrawable(icon(kind, ink, 24));
        button.setBackground(actionSurface(Color.TRANSPARENT, 16));
        button.setContentDescription(label);
        button.setOnClickListener(view -> run.run());
        return button;
    }

    TextView action(String label, int background, int foreground, Runnable run) {
        TextView button = text(label, 15, foreground, true);
        button.setMinHeight(dp(48));
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(14), dp(8), dp(14), dp(8));
        button.setBackground(actionSurface(background, 15));
        button.setOnClickListener(view -> run.run());
        return button;
    }

    LinearLayout option(Kind kind, String label, Runnable run) {
        LinearLayout row = row();
        row.setMinimumHeight(dp(49));
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), 0, dp(10), 0);
        row.setBackground(actionSurface(Color.TRANSPARENT, 12));
        row.addView(glyph(kind, accent, 20), new LinearLayout.LayoutParams(dp(24), dp(28)));
        TextView name = oneLine(label, 15, ink, false);
        name.setPadding(dp(10), 0, 0, 0);
        row.addView(name, new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        row.setContentDescription(label);
        row.setOnClickListener(view -> run.run());
        return row;
    }

    private EditText edit(String hint, boolean uri) {
        EditText edit = new EditText(activity);
        edit.setSingleLine(true);
        edit.setTextSize(16);
        edit.setTextColor(ink);
        edit.setHintTextColor(muted);
        edit.setHint(hint);
        edit.setContentDescription(hint);
        edit.setInputType(InputType.TYPE_CLASS_TEXT | (uri ? InputType.TYPE_TEXT_VARIATION_URI : InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS));
        edit.setMinHeight(dp(48));
        edit.setPadding(dp(13), dp(6), dp(13), dp(6));
        edit.setBackground(shape(soft, 14, line));
        edit.setSelectAllOnFocus(uri);
        return edit;
    }

    private void watch(EditText field, Runnable changed) {
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence text, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence text, int start, int before, int count) { changed.run(); }
            @Override public void afterTextChanged(Editable text) {}
        });
    }

    private final class SwipeBar extends LinearLayout {
        private float downX, downY;
        private boolean swiping;

        SwipeBar() { super(activity); }

        @Override public boolean onInterceptTouchEvent(MotionEvent event) {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                downX = event.getX();
                downY = event.getY();
                swiping = false;
            } else if (event.getActionMasked() == MotionEvent.ACTION_MOVE && panelName == null) {
                float x = Math.abs(event.getX() - downX);
                float y = Math.abs(event.getY() - downY);
                swiping = x > dp(22) && x > y * 1.6f;
            }
            return swiping;
        }

        @Override public boolean onTouchEvent(MotionEvent event) {
            if (!swiping) return super.onTouchEvent(event);
            if (event.getActionMasked() == MotionEvent.ACTION_UP) {
                float distance = event.getX() - downX;
                if (Math.abs(distance) > dp(46)) activity.step(distance < 0 ? 1 : -1);
                else performClick();
                swiping = false;
            } else if (event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                swiping = false;
            }
            return true;
        }

        @Override public boolean performClick() {
            return super.performClick();
        }
    }
}

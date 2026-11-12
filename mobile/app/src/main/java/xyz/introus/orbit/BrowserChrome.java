package xyz.introus.orbit;

import android.animation.ValueAnimator;
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
import android.view.animation.DecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
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
import java.util.List;
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
    private final FrameLayout window;
    private final FrameLayout stage;
    private final LinearLayout controls;
    private final SwipeBar bar;
    private final ProgressBar progress;
    private final TextView address;
    private final TextView tabButton;
    private final ImageButton more;
    private final Map<String, Bitmap> images = new HashMap<>();
    private PanelLayer panel;
    private EditText searchInput;
    private TextView panelTitle;
    private StartPage home;
    private LinearLayout splitLayout;
    private FrameLayout[] splitFrames;
    private TextView[] splitTitles;
    private TabStore.Tab[] splitTabs;
    private BrowserSettings settings;
    private BrowserPage findPage;
    private String panelName;
    private TabStore.Tab presentedTab;
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
        stage = new FrameLayout(activity);
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

        window = new FrameLayout(activity);
        window.addView(root, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        activity.setContentView(window);
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
        dark = activity.privateMode() || mode.equals("dark") || ((mode.equals("system") || mode.equals("space")) &&
                (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                        == Configuration.UI_MODE_NIGHT_YES);
        paper = dark ? 0xff1c1923 : 0xfff8f5f2;
        card = dark ? 0xff282333 : 0xfffffdfd;
        ink = dark ? 0xfff8f1fb : 0xff251f2d;
        muted = dark ? 0xffc5bacf : 0xff62586d;
        line = dark ? 0xff3f364b : 0xffe6dde7;
        int custom = activity.preferences.getInt("accent", 0);
        if (mode.equals("space") && custom == 0) custom = activity.store.activeSpace().color;
        accent = custom == 0 ? (dark ? 0xffc6b6ff : 0xff51419a) :
                mix(custom, dark ? Color.WHITE : 0xff161128, dark ? .42f : .45f);
        onAccent = dark ? 0xff18121e : Color.WHITE;
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
        if ("settings".equals(panelName) && panel != null) {
            panel.getChildAt(0).setBackground(shape(card, radius(24), line));
            if (panelTitle != null) {
                panelTitle.setTextColor(ink);
                LinearLayout header = (LinearLayout) panelTitle.getParent();
                ((ImageButton) header.getChildAt(1)).setImageDrawable(icon(Kind.CLOSE, ink, 24));
            }
        }
        int position = activity.preferences.getString("toolbarPosition", "bottom").equals("top") ? 0 : 1;
        if (root.indexOfChild(controls) != position) {
            root.removeView(controls);
            root.addView(controls, position);
        }
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
        boolean entering = presentedTab != tab || splitLayout != null;
        presentedTab = tab;
        clearSplitUi();
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
        if (entering) revealPage();
        updateBar(tab, page);
    }

    void presentSplit(BrowserPage first, BrowserPage second) {
        presentedTab = activity.store.active;
        TabStore.Tab a = activity.store.splitFirst, b = activity.store.splitSecond;
        boolean sideBySide = activity.preferences.getString("splitDirection", "auto").equals("side")
                || (activity.preferences.getString("splitDirection", "auto").equals("auto")
                && activity.getResources().getConfiguration().screenWidthDp >= 600);
        int direction = sideBySide ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL;
        if (splitLayout == null || splitLayout.getOrientation() != direction || splitTabs[0] != a || splitTabs[1] != b) {
            content.removeAllViews();
            home = null;
            splitLayout = new LinearLayout(activity);
            splitLayout.setOrientation(direction);
            splitTabs = new TabStore.Tab[]{a, b};
            splitTitles = new TextView[2];
            splitFrames = new FrameLayout[2];
            for (int index = 0; index < 2; index++) {
                if (index == 1) splitLayout.addView(divider(sideBySide), new LinearLayout.LayoutParams(
                        sideBySide ? dp(16) : MATCH_PARENT, sideBySide ? MATCH_PARENT : dp(16)));
                TabStore.Tab tab = splitTabs[index];
                LinearLayout pane = column();
                LinearLayout header = row();
                header.setGravity(Gravity.CENTER_VERTICAL);
                TextView title = oneLine(tab.label(), 13, ink, true);
                title.setPadding(dp(10), 0, dp(4), 0);
                title.setGravity(Gravity.CENTER_VERTICAL);
                title.setOnClickListener(view -> activity.focusPane(tab));
                header.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
                header.addView(iconButton(Kind.CLOSE, "분할 화면 해제", () -> {
                    activity.focusPane(tab);
                    activity.endSplit();
                }), new LinearLayout.LayoutParams(dp(48), dp(48)));
                pane.addView(header);
                FrameLayout frame = new FrameLayout(activity);
                pane.addView(frame, new LinearLayout.LayoutParams(MATCH_PARENT, 0, 1));
                splitFrames[index] = frame;
                splitTitles[index] = title;
                splitLayout.addView(pane, paneSize(sideBySide, index));
            }
            content.addView(splitLayout, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
            revealPage();
        }
        updatePane(0, first);
        updatePane(1, second);
        updateSplitFocus();
    }

    private void clearSplitUi() {
        splitLayout = null;
        splitFrames = null;
        splitTitles = null;
        splitTabs = null;
    }

    private boolean motionEnabled() {
        return ValueAnimator.areAnimatorsEnabled() && activity.preferences.getBoolean("animations", true);
    }

    private void revealPage() {
        content.animate().cancel();
        if (!motionEnabled()) {
            content.setAlpha(1f);
            return;
        }
        content.setAlpha(.7f);
        content.animate().alpha(1f).setDuration(180).setInterpolator(new DecelerateInterpolator()).start();
    }

    private LinearLayout.LayoutParams paneSize(boolean side, int index) {
        float ratio = activity.store.splitRatio;
        return new LinearLayout.LayoutParams(side ? 0 : MATCH_PARENT, side ? MATCH_PARENT : 0,
                index == 0 ? ratio : 1f - ratio);
    }

    private View divider(boolean side) {
        FrameLayout target = new FrameLayout(activity);
        target.setContentDescription("분할 비율 조절");
        target.setFocusable(true);
        target.setOnClickListener(view -> splitRatio(.5f, side, true));
        View grip = new View(activity);
        grip.setBackground(shape(muted, 3, 0));
        target.addView(grip, new FrameLayout.LayoutParams(side ? dp(4) : dp(34), side ? dp(34) : dp(4), Gravity.CENTER));
        target.setBackgroundColor(soft);
        target.setOnTouchListener(new View.OnTouchListener() {
            private float start, initial;
            @Override public boolean onTouch(View view, MotionEvent event) {
                float position = side ? event.getRawX() : event.getRawY();
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    start = position;
                    initial = activity.store.splitRatio;
                    return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                    int extent = side ? splitLayout.getWidth() : splitLayout.getHeight();
                    if (extent > 0) splitRatio(initial + (position - start) / extent, side, false);
                    return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                    if (event.getActionMasked() == MotionEvent.ACTION_UP && Math.abs(position - start) < dp(5)) view.performClick();
                    activity.store.save();
                    return true;
                }
                return false;
            }
        });
        target.setOnKeyListener((view, key, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            int increase = side ? KeyEvent.KEYCODE_DPAD_RIGHT : KeyEvent.KEYCODE_DPAD_DOWN;
            int decrease = side ? KeyEvent.KEYCODE_DPAD_LEFT : KeyEvent.KEYCODE_DPAD_UP;
            if (key != increase && key != decrease) return false;
            splitRatio(activity.store.splitRatio + (key == increase ? .05f : -.05f), side, true);
            return true;
        });
        return target;
    }

    private void splitRatio(float ratio, boolean side, boolean persist) {
        activity.store.splitRatio = Math.max(.28f, Math.min(.72f, ratio));
        splitLayout.getChildAt(0).setLayoutParams(paneSize(side, 0));
        splitLayout.getChildAt(2).setLayoutParams(paneSize(side, 1));
        if (persist) activity.store.save();
    }

    private void updatePane(int index, BrowserPage page) {
        FrameLayout frame = splitFrames[index];
        TabStore.Tab tab = splitTabs[index];
        if (page != null && page.error == null && page.getParent() == frame) return;
        frame.removeAllViews();
        if (tab.url == null) {
            TextView blank = action("주소 또는 검색어 입력", soft, ink, () -> {
                activity.focusPane(tab);
                showSearch(true);
            });
            FrameLayout.LayoutParams size = new FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.CENTER);
            frame.addView(blank, size);
        } else if (page == null || page.error != null) {
            TextView retry = action(page == null ? "페이지 다시 열기" : page.error, soft, ink, () -> {
                activity.focusPane(tab);
                activity.reload();
            });
            frame.addView(retry, new FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.CENTER));
        } else {
            if (page.getParent() instanceof ViewGroup) ((ViewGroup) page.getParent()).removeView(page);
            frame.addView(page, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        }
    }

    void updateSplitFocus() {
        if (splitTitles == null) return;
        for (int i = 0; i < splitTitles.length; i++) {
            boolean active = splitTabs[i] == activity.store.active;
            splitTitles[i].setText(splitTabs[i].label());
            splitTitles[i].setSelected(active);
            ((View) splitTitles[i].getParent()).setBackgroundColor(active ? soft : card);
        }
        updateBar(activity.store.active, activity.activePage());
    }

    void fullscreen(View video) {
        if (video == null) {
            if (window.getChildCount() > 1) window.removeViewAt(1);
            root.setVisibility(View.VISIBLE);
        } else {
            root.setVisibility(View.GONE);
            window.addView(video, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        }
    }

    void showCrash(TabStore.Tab tab) {
        clearSplitUi();
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
        String prefix = activity.privateMode() ? "시크릿 · " : "";
        address.setText(prefix + (home ? "검색 또는 웹 주소" : http ? "HTTP · " + host : host));
        address.setContentDescription(prefix + (home ? "검색 또는 웹 주소 입력" : "주소 입력, " + tab.url));
        Drawable symbol = icon(home ? Kind.SEARCH : secure ? Kind.LOCK : Kind.GLOBE, muted, 18);
        symbol.setBounds(0, 0, dp(18), dp(18));
        address.setCompoundDrawablesRelative(symbol, null, null, null);
        int count = activity.store.currentTabs().size();
        tabButton.setText(String.valueOf(count));
        tabButton.setContentDescription("탭 전환, " + count + "개 열림");
        boolean loading = page != null && page.progress < 100;
        progress.setVisibility(loading ? View.VISIBLE : View.INVISIBLE);
        progress.setProgress(loading ? page.progress : 0);
    }

    void showSearch(boolean blank) {
        LinearLayout sheet = openPanel("search", "주소와 검색");
        EditText input = edit("검색어 또는 웹 주소", true);
        searchInput = input;
        input.setImeOptions(EditorInfo.IME_ACTION_GO | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        String current = blank ? "" : activity.store.active.url;
        input.setText(current == null ? "" : current);
        addTop(sheet, input, 14);
        LinearLayout suggestions = column();
        addTop(sheet, suggestions, 10);
        LinearLayout online = column();
        addTop(sheet, online, 3);
        Runnable[] pending = {null};
        Runnable refresh = () -> {
            suggestions.removeAllViews();
            online.removeAllViews();
            if (pending[0] != null) root.removeCallbacks(pending[0]);
            String query = input.getText().toString().trim();
            if (query.isEmpty()) {
                suggestions.addView(text(activity.searchEngine().label + "에서 검색", 14, muted, false));
                return;
            }
            suggestions.addView(option(Kind.SEARCH, "입력한 주소 열기 또는 검색", () -> activity.search(query)));
            if (!activity.preferences.getBoolean("autocomplete", true)) return;
            String needle = query.toLowerCase(Locale.ROOT);
            int count = 0;
            for (TabStore.Tab tab : activity.store.tabs) {
                if (tab == activity.store.active || tab.url == null || count == 2) continue;
                if ((tab.label() + " " + tab.url).toLowerCase(Locale.ROOT).contains(needle)) {
                    suggestions.addView(option(Kind.TABS, tab.label(), () -> activity.select(tab)));
                    count++;
                }
            }
            if (!activity.privateMode()) {
                for (TabStore.Search item : activity.store.searches) {
                    if (count >= 3) break;
                    if (item.space.equals(activity.store.active.space) && !item.text.equals(query)
                            && item.text.toLowerCase(Locale.ROOT).contains(needle)) {
                        suggestions.addView(option(Kind.SEARCH, item.text, () -> activity.search(item.text)));
                        count++;
                    }
                }
                if (activity.searchEngine() == WebAddress.SearchEngine.GOOGLE
                        && activity.preferences.getBoolean("onlineSuggestions", false) && query.length() >= 2
                        && query.length() <= 120 && query.indexOf('.') < 0 && query.indexOf(':') < 0 && query.indexOf('/') < 0) {
                    pending[0] = () -> {
                        if (searchInput != input || !input.isAttachedToWindow() || !input.getText().toString().trim().equals(query)
                                || !activity.preferences.getBoolean("onlineSuggestions", false)) return;
                        SearchSuggestions.request(query, results -> activity.runOnUiThread(() -> {
                            if (searchInput != input || !input.isAttachedToWindow()
                                    || !input.getText().toString().trim().equals(query)) return;
                            for (String suggestion : results)
                                online.addView(option(Kind.SEARCH, suggestion, () -> activity.search(suggestion)));
                        }));
                    };
                    root.postDelayed(pending[0], 330);
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
        LinearLayout sheet = openPanel("tabs", "탭 · " + activity.store.currentTabs().size());
        if (!activity.privateMode())
            addTop(sheet, option(Kind.TABS, "스페이스 · " + activity.store.activeSpace().name, this::showSpaces), 2);
        LinearLayout buttons = row();
        buttons.setGravity(Gravity.CENTER_VERTICAL);
        EditText filter = edit("탭 제목 또는 주소로 찾기", false);
        if (activity.preferences.getBoolean("showTabSearchTool", true))
            buttons.addView(filter, new LinearLayout.LayoutParams(0, dp(48), 1));
        ImageButton add = iconButton(Kind.PLUS, "새 탭 추가", activity::newTab);
        add.setBackground(actionSurface(soft, 16));
        LinearLayout.LayoutParams addSize = new LinearLayout.LayoutParams(dp(48), dp(48));
        addSize.setMarginStart(dp(8));
        buttons.addView(add, addSize);
        addTop(sheet, buttons, 14);

        LinearLayout library = column();
        addTop(sheet, library, 10);
        HorizontalScrollView deck = new HorizontalScrollView(activity);
        deck.setHorizontalScrollBarEnabled(false);
        deck.setClipToPadding(false);
        LinearLayout cards = row();
        deck.addView(cards);
        addTop(sheet, deck, 12);
        LinearLayout recent = column();
        addTop(sheet, recent, 10);
        Runnable draw = () -> {
            drawLibrary(library, filter.getText().toString().trim());
            drawTabs(cards, recent, filter.getText().toString());
        };
        watch(filter, draw);
        draw.run();
        deck.post(() -> {
            for (int index = 0; index < cards.getChildCount(); index++) {
                View card = cards.getChildAt(index);
                if (card.getTag() == activity.store.active) {
                    deck.scrollTo(Math.max(0, card.getLeft() - dp(10)), 0);
                    break;
                }
            }
        });
    }

    private void drawTabs(LinearLayout cards, LinearLayout recent, String rawFilter) {
        if (panelTitle != null) panelTitle.setText("탭 · " + activity.store.currentTabs().size());
        String filter = rawFilter.trim().toLowerCase(Locale.ROOT);
        cards.removeAllViews();
        recent.removeAllViews();
        int width = Math.max(170, Math.min(255, activity.getResources().getConfiguration().screenWidthDp - 92));
        boolean list = activity.preferences.getString("tabStyle", "cards").equals("list");
        cards.setOrientation(list ? LinearLayout.VERTICAL : LinearLayout.HORIZONTAL);
        ViewGroup.LayoutParams cardsSize = cards.getLayoutParams();
        cardsSize.width = list ? MATCH_PARENT : WRAP_CONTENT;
        cards.setLayoutParams(cardsSize);
        ((HorizontalScrollView) cards.getParent()).setFillViewport(list);
        for (TabStore.Tab tab : filter.isEmpty() ? activity.store.currentTabs() : activity.store.tabs) {
            if (filter.isEmpty() && (tab.pinned || tab.group != null)) continue;
            String details = tab.label() + " " + (tab.url == null ? "" : tab.url) + " " + activity.store.space(tab.space).name;
            if (!details.toLowerCase(Locale.ROOT).contains(filter)) continue;
            FrameLayout tile = new FrameLayout(activity);
            tile.setTag(tab);
            LinearLayout open = column();
            open.setBackground(actionSurface(tab == activity.store.active ? soft : card, 18));
            open.setClipToOutline(true);
            open.setOnClickListener(view -> activity.select(tab));
            open.setOnLongClickListener(view -> { showTabActions(tab); return true; });
            open.setContentDescription(tab.label() + (tab == activity.store.active ? ", 현재 탭" : ", 열기"));
            Bitmap preview = activity.previewFor(tab);
            if (!list && preview == null && tab.url == null) preview = image("wallpapers/seoul-" + StartPage.scene(activity) + ".jpg");
            if (!list && preview != null) {
                ImageView image = new ImageView(activity);
                image.setImageBitmap(preview);
                image.setScaleType(ImageView.ScaleType.CENTER_CROP);
                open.addView(image, new LinearLayout.LayoutParams(MATCH_PARENT, dp(112)));
            } else if (!list) {
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
            if (list) labels.setPadding(dp(12), dp(10), dp(53), dp(11));
            labels.addView(oneLine(tab.label(), 15, ink, true));
            String detail = tab.url == null ? "Orbit 시작 페이지" : WebAddress.displayHost(tab.url);
            if (!tab.space.equals(activity.store.active.space)) detail += " · " + activity.store.space(tab.space).name;
            addTop(labels, oneLine(detail, 12, muted, false), 4);
            open.addView(labels);
            tile.addView(open, new FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT));
            ImageButton close = iconButton(Kind.CLOSE, tab.label() + " 닫기", () -> {
                activity.close(tab);
                showTabs();
            });
            close.setBackground(actionSurface(card, 18));
            FrameLayout.LayoutParams closeSize = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.END | Gravity.TOP);
            closeSize.setMargins(0, dp(5), dp(5), 0);
            if (activity.preferences.getBoolean("showTabClose", true)) tile.addView(close, closeSize);
            LinearLayout.LayoutParams cardSize = new LinearLayout.LayoutParams(list ? MATCH_PARENT : dp(width), WRAP_CONTENT);
            if (list) cardSize.bottomMargin = dp(7); else cardSize.setMarginEnd(dp(9));
            cards.addView(tile, cardSize);
        }
        if (cards.getChildCount() == 0) {
            TextView empty = text(filter.isEmpty() ? "일반 탭이 없어요." : "일치하는 열린 탭이 없어요.", 14, muted, false);
            empty.setPadding(dp(2), dp(14), 0, dp(14));
            cards.addView(empty);
        }
        int shown = 0;
        for (TabStore.Page entry : activity.store.closed) {
            if (filter.isEmpty() && !entry.space.equals(activity.store.active.space)) continue;
            if (!(entry.title + " " + entry.url).toLowerCase(Locale.ROOT).contains(filter)) continue;
            if (shown++ == 0) addTop(recent, text("최근 닫은 탭", 14, muted, true), 6);
            recent.addView(option(Kind.RELOAD, entry.title, () -> activity.restore(entry)));
        }
    }

    private void drawLibrary(LinearLayout library, String query) {
        library.removeAllViews();
        if (!query.isEmpty()) return;
        TabStore store = activity.store;
        if (!store.bookmarks.isEmpty()) {
            addTop(library, text("즐겨찾기", 14, muted, true), 3);
            LinearLayout line = null;
            for (int i = 0; i < Math.min(store.bookmarks.size(), 6); i++) {
                if (i % 3 == 0) { line = row(); addTop(library, line, 5); }
                TabStore.Page page = store.bookmarks.get(i);
                LinearLayout tile = column();
                tile.setGravity(Gravity.CENTER);
                tile.setMinimumHeight(dp(58));
                tile.setBackground(actionSurface(soft, 12));
                ImageView icon = favicon(page.url);
                tile.addView(icon, new LinearLayout.LayoutParams(dp(24), dp(24)));
                tile.setContentDescription(page.title);
                tile.setOnClickListener(view -> activity.open(page.url, true));
                tile.setOnLongClickListener(view -> { showBookmarkActions(page); return true; });
                LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(0, dp(58), 1);
                size.setMarginEnd(dp(5));
                line.addView(tile, size);
            }
            if (store.bookmarks.size() > 6) library.addView(option(Kind.STAR, "즐겨찾기 모두 보기", this::showFavorites));
        }
        List<TabStore.Tab> tabs = store.currentTabs();
        boolean pinned = false;
        for (TabStore.Tab tab : tabs) {
            if (!tab.pinned || tab.group != null) continue;
            if (!pinned) addTop(library, text("고정 탭", 14, muted, true), 10);
            pinned = true;
            library.addView(tabRow(tab));
        }
        for (TabStore.Group group : store.groups) {
            if (!group.space.equals(store.active.space)) continue;
            LinearLayout card = column();
            card.setPadding(dp(6), dp(2), dp(6), dp(4));
            card.setBackground(shape(mix(this.card, group.color, dark ? .22f : .20f), radius(16), line));
            TextView header = action(group.name + (group.collapsed ? "  ›" : "  ⌄"),
                    Color.TRANSPARENT, ink, () -> {
                        group.collapsed = !group.collapsed;
                        store.save();
                        drawLibrary(library, "");
                    });
            header.setContentDescription(group.name + (group.collapsed ? ", 접힘" : ", 펼쳐짐"));
            header.setOnLongClickListener(view -> { showGroupEditor(group, null); return true; });
            card.addView(header);
            if (!group.collapsed) for (TabStore.Tab tab : tabs) {
                if (group.id.equals(tab.group)) card.addView(tabRow(tab));
            }
            addTop(library, card, 7);
        }
        addTop(library, option(Kind.PLUS, "새 탭 그룹", () -> showGroupEditor(null, null)), 3);
    }

    private ImageView favicon(String url) {
        String host = WebAddress.displayHost(url);
        String known = host.equals("google.com") ? "google" : host.equals("youtube.com") ? "youtube" :
                host.equals("discord.com") ? "discord" : host.equals("naver.com") ? "naver" : host.equals("github.com") ? "github" : null;
        ImageView icon = glyph(Kind.GLOBE, accent, 20);
        if (known != null) icon.setImageBitmap(image("sites/" + known + ".png"));
        else if (url != null) for (TabStore.Tab tab : activity.store.currentTabs()) {
            if (!host.equals(WebAddress.displayHost(tab.url))) continue;
            BrowserPage page = activity.pageFor(tab);
            if (page != null && page.favicon != null) { icon.setImageBitmap(page.favicon); break; }
        }
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        return icon;
    }

    private View tabRow(TabStore.Tab tab) {
        LinearLayout row = row();
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout open = row();
        open.setGravity(Gravity.CENTER_VERTICAL);
        open.setPadding(dp(9), 0, dp(9), 0);
        open.setBackground(actionSurface(tab == activity.store.active ? soft : Color.TRANSPARENT, 12));
        open.addView(favicon(tab.url), new LinearLayout.LayoutParams(dp(19), dp(19)));
        TextView title = oneLine(tab.label(), 15, ink, true);
        title.setPadding(dp(8), 0, 0, 0);
        open.addView(title, new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        open.setContentDescription(tab.label());
        open.setOnClickListener(view -> activity.select(tab));
        open.setOnLongClickListener(view -> { showTabActions(tab); return true; });
        row.addView(open, new LinearLayout.LayoutParams(0, dp(48), 1));
        row.addView(iconButton(Kind.MORE, tab.label() + " 관리", () -> showTabActions(tab)), new LinearLayout.LayoutParams(dp(48), dp(48)));
        return row;
    }

    private void showTabActions(TabStore.Tab tab) {
        LinearLayout sheet = openPanel("tab-actions", tab.label());
        sheet.addView(option(Kind.STAR, tab.pinned ? "탭 고정 해제" : "탭 고정", () -> {
            tab.pinned = !tab.pinned;
            activity.store.save();
            showTabs();
        }));
        sheet.addView(option(Kind.TABS, "탭 그룹으로 이동", () -> showGroupPicker(tab)));
        if (activity.store.spaces.size() > 1 && activity.canUseSpaces()) sheet.addView(option(Kind.GLOBE,
                "스페이스로 이동", () -> {
                    LinearLayout picker = openPanel("move-space", "스페이스로 이동");
                    for (TabStore.Space space : activity.store.spaces) if (!space.id.equals(tab.space))
                        picker.addView(option(Kind.TABS, space.name, () -> activity.moveTab(tab, space)));
                }));
        if (tab.url != null) {
            sheet.addView(option(Kind.PLUS, "탭 복제", () -> activity.duplicate(tab)));
            sheet.addView(option(Kind.GLOBE, "주소 복사", () -> { dismissPanel(); activity.copy(tab.url); }));
            if (tab != activity.store.active && tab.space.equals(activity.store.active.space))
                sheet.addView(option(Kind.TABS, "분할 화면에서 열기", () -> activity.startSplit(tab)));
        }
        sheet.addView(option(Kind.BACK, "앞으로 이동", () -> { activity.reorder(tab, -1); showTabs(); }));
        sheet.addView(option(Kind.FORWARD, "뒤로 이동", () -> { activity.reorder(tab, 1); showTabs(); }));
        sheet.addView(option(Kind.CLOSE, "탭 닫기", () -> { activity.close(tab); showTabs(); }));
    }

    private void showGroupPicker(TabStore.Tab tab) {
        LinearLayout sheet = openPanel("groups", "탭 그룹");
        sheet.addView(option(Kind.PLUS, "새 탭 그룹 만들기", () -> showGroupEditor(null, tab)));
        if (tab.group != null) sheet.addView(option(Kind.CLOSE, "그룹에서 빼기", () -> {
            tab.group = null;
            activity.store.save();
            showTabs();
        }));
        for (TabStore.Group group : activity.store.groups) if (group.space.equals(tab.space))
            sheet.addView(option(Kind.TABS, group.name, () -> {
                tab.group = group.id;
                group.collapsed = false;
                activity.store.save();
                showTabs();
            }));
    }

    private void showGroupEditor(TabStore.Group group, TabStore.Tab tab) {
        if (tab != null && !tab.space.equals(activity.store.active.space)) activity.select(tab);
        LinearLayout sheet = openPanel("group-edit", group == null ? "새 탭 그룹" : "탭 그룹 편집");
        EditText name = edit("그룹 이름", false);
        if (group != null) name.setText(group.name);
        addTop(sheet, name, 5);
        int[] selected = {group == null ? BrowserSettings.COLORS[0] : group.color};
        addTop(sheet, colorPicker(selected), 10);
        addTop(sheet, action("저장", accent, onAccent, () -> {
            if (name.getText().toString().trim().isEmpty()) { activity.toast("그룹 이름을 입력해 주세요."); return; }
            TabStore.Group target = group == null ? activity.store.createGroup(name.getText().toString(), selected[0]) : group;
            if (target == null) { activity.toast("그룹을 더 추가할 수 없어요."); return; }
            target.name = TabStore.label(name.getText().toString(), target.name, 40);
            target.color = selected[0];
            if (tab != null) tab.group = target.id;
            activity.store.save();
            showTabs();
        }), 10);
        if (group != null) sheet.addView(option(Kind.CLOSE, "그룹 해제", () -> {
            activity.store.removeGroup(group);
            activity.store.save();
            showTabs();
        }));
    }

    private LinearLayout colorPicker(int[] selected) {
        LinearLayout row = row();
        for (int i = 0; i < BrowserSettings.COLORS.length; i++) {
            int color = BrowserSettings.COLORS[i];
            TextView swatch = action(color == selected[0] ? "✓" : "", color, 0xff191528, () -> {
                selected[0] = color;
                for (int index = 0; index < row.getChildCount(); index++)
                    ((TextView) row.getChildAt(index)).setText(BrowserSettings.COLORS[index] == color ? "✓" : "");
            });
            swatch.setContentDescription(BrowserSettings.COLOR_LABELS[i]);
            LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(0, dp(48), 1);
            size.setMarginEnd(dp(5));
            row.addView(swatch, size);
        }
        return row;
    }

    private void showSpaces() {
        LinearLayout sheet = openPanel("spaces", "스페이스");
        for (TabStore.Space space : activity.store.spaces) {
            LinearLayout row = row();
            LinearLayout open = option(Kind.TABS, space.name + (space == activity.store.activeSpace() ? " · 현재" : ""),
                    () -> activity.switchSpace(space));
            row.addView(open, new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
            row.addView(iconButton(Kind.SETTINGS, space.name + " 편집", () -> showSpaceEditor(space)),
                    new LinearLayout.LayoutParams(dp(48), dp(48)));
            sheet.addView(row);
        }
        if (activity.canUseSpaces()) sheet.addView(option(Kind.PLUS, "스페이스 만들기", () -> showSpaceEditor(null)));
        else addTop(sheet, text("로그인이 분리된 새 스페이스는 멀티 프로필을 지원하는 Android System WebView에서 열 수 있어요.",
                13, muted, false), 10);
    }

    private void showSpaceEditor(TabStore.Space space) {
        LinearLayout sheet = openPanel("space-edit", space == null ? "스페이스 만들기" : "스페이스 편집");
        EditText name = edit("스페이스 이름", false);
        if (space != null) name.setText(space.name);
        addTop(sheet, name, 6);
        int[] color = {space == null ? BrowserSettings.COLORS[0] : space.color};
        addTop(sheet, colorPicker(color), 10);
        addTop(sheet, action("저장", accent, onAccent, () -> {
            String value = TabStore.label(name.getText().toString(), "", 40);
            if (value.isEmpty()) { activity.toast("스페이스 이름을 입력해 주세요."); return; }
            TabStore.Space target = space == null ? activity.store.createSpace(value, color[0]) : space;
            if (target == null) { activity.toast("스페이스를 더 추가할 수 없어요."); return; }
            target.name = value;
            target.color = color[0];
            activity.store.save();
            if (target == activity.store.activeSpace()) {
                updateTheme();
                activity.renderActive();
                showSpaces();
            } else activity.switchSpace(target);
        }), 10);
        if (space != null && !TabStore.DEFAULT.equals(space.id)) sheet.addView(option(Kind.CLOSE, "스페이스 삭제", () -> {
            LinearLayout confirmation = openPanel("space-delete", "스페이스 삭제");
            addTop(confirmation, text(space.name + "의 탭과 기록을 지웁니다. WebView 저장소는 Orbit을 다시 열 때 정리됩니다.",
                    14, muted, false), 4);
            addTop(confirmation, action("스페이스 삭제", accent, onAccent, () -> activity.deleteSpace(space)), 12);
        }));
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
            if (!activity.privateMode() && activity.preferences.getBoolean("showFavoriteTool", true))
                sheet.addView(option(Kind.STAR, activity.store.hasBookmark(tab.url) ? "즐겨찾기에서 제거" : "즐겨찾기에 추가",
                    () -> { dismissPanel(); activity.toggleBookmark(); }));
            sheet.addView(option(Kind.SETTINGS, "페이지 도구", this::showPageTools));
            sheet.addView(option(Kind.SHARE, "페이지 공유", () -> { dismissPanel(); activity.share(tab.url); }));
            sheet.addView(option(Kind.GLOBE, "주소 복사", () -> { dismissPanel(); activity.copy(tab.url); }));
        }
        sheet.addView(option(Kind.PLUS, "새 탭", activity::newTab));
        sheet.addView(option(Kind.LOCK, activity.privateMode() ? "시크릿 모드 종료" : "새 시크릿 창", activity::openPrivate));
        if (activity.preferences.getBoolean("showSplitTool", true))
            sheet.addView(option(Kind.TABS, activity.store.isSplitTab(tab) ? "분할 화면 해제" : "분할 화면",
                    () -> { if (activity.store.isSplitTab(tab)) activity.endSplit(); else showSplitPicker(); }));
        sheet.addView(option(Kind.TABS, "탭 전환", this::showTabs));
        if (!activity.privateMode()) {
            sheet.addView(option(Kind.TABS, "스페이스", this::showSpaces));
            sheet.addView(option(Kind.STAR, "즐겨찾기", this::showFavorites));
            sheet.addView(option(Kind.GLOBE, "검색·방문 기록", this::showHistory));
            sheet.addView(option(Kind.FORWARD, "다운로드", activity::downloads));
            sheet.addView(option(Kind.TABS, "웹 패널", this::showWebPanel));
            sheet.addView(option(Kind.SETTINGS, "설정", this::showSettings));
        }
    }

    private void showSplitPicker() {
        LinearLayout sheet = openPanel("split-picker", "분할 화면");
        addTop(sheet, text("함께 볼 탭을 선택하세요.", 14, muted, false), 3);
        for (TabStore.Tab tab : activity.store.currentTabs()) if (tab != activity.store.active)
            sheet.addView(option(Kind.TABS, tab.label(), () -> activity.startSplit(tab)));
        sheet.addView(option(Kind.PLUS, "새 탭과 분할", () -> activity.startSplit(null)));
    }

    private void showWebPanel() {
        LinearLayout sheet = openPanel("web-panel", "웹 패널");
        EditText field = edit("함께 볼 웹사이트 주소", true);
        addTop(sheet, field, 6);
        addTop(sheet, action("웹 패널 열기", accent, onAccent, () -> openCompanion(field.getText().toString())), 10);
        for (int i = 0; i < Math.min(activity.store.bookmarks.size(), 6); i++) {
            TabStore.Page page = activity.store.bookmarks.get(i);
            sheet.addView(option(Kind.STAR, page.title, () -> openCompanion(page.url)));
        }
    }

    private void openCompanion(String text) {
        String url = WebAddress.resolve(text, activity.searchEngine());
        if (url == null) { activity.toast("웹 주소를 입력해 주세요."); return; }
        if (activity.store.tabs.size() >= TabStore.MAX_TABS) { activity.toast("탭을 닫은 뒤 다시 시도해 주세요."); return; }
        activity.startSplit(null);
        activity.open(url, false);
    }

    void showFavorites() {
        LinearLayout sheet = openPanel("favorites", "즐겨찾기");
        EditText filter = edit("즐겨찾기 검색", false);
        addTop(sheet, filter, 5);
        LinearLayout results = column();
        addTop(sheet, results, 7);
        Runnable draw = () -> {
            results.removeAllViews();
            String query = filter.getText().toString().trim().toLowerCase(Locale.ROOT);
            for (TabStore.Page page : activity.store.bookmarks) {
                if (!(page.title + " " + page.url).toLowerCase(Locale.ROOT).contains(query)) continue;
                LinearLayout row = row();
                row.addView(option(Kind.STAR, page.title, () -> activity.open(page.url, false)),
                        new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
                row.addView(iconButton(Kind.MORE, page.title + " 편집", () -> showBookmarkActions(page)),
                        new LinearLayout.LayoutParams(dp(48), dp(48)));
                results.addView(row);
            }
            if (results.getChildCount() == 0) addTop(results, text("표시할 즐겨찾기가 없어요.", 14, muted, false), 8);
        };
        watch(filter, draw);
        draw.run();
    }

    private void showBookmarkActions(TabStore.Page page) {
        LinearLayout sheet = openPanel("bookmark-edit", "즐겨찾기 편집");
        EditText title = edit("즐겨찾기 이름", false);
        title.setText(page.title);
        EditText address = edit("웹 주소", true);
        address.setText(page.url);
        addTop(sheet, title, 5);
        addTop(sheet, address, 8);
        addTop(sheet, action("저장", accent, onAccent, () -> {
            String raw = address.getText().toString().trim();
            String url = WebAddress.normalize(raw.contains("://") ? raw : "https://" + raw);
            if (url == null) { activity.toast("올바른 웹 주소를 입력해 주세요."); return; }
            if (!url.equals(page.url) && activity.store.hasBookmark(url)) { activity.toast("이미 추가된 즐겨찾기예요."); return; }
            int index = activity.store.bookmarks.indexOf(page);
            if (index >= 0) activity.store.bookmarks.set(index, new TabStore.Page(url, title.getText().toString()));
            activity.store.save();
            activity.renderActive();
            showFavorites();
        }), 9);
        sheet.addView(option(Kind.CLOSE, "즐겨찾기에서 제거", () -> { activity.removeBookmark(page); showFavorites(); }));
    }

    void showHistory() {
        if (activity.privateMode()) return;
        LinearLayout sheet = openPanel("history", "검색·방문 기록");
        EditText input = edit("기록 검색", false);
        addTop(sheet, input, 5);
        LinearLayout results = column();
        addTop(sheet, results, 8);
        Runnable draw = () -> {
            results.removeAllViews();
            String query = input.getText().toString().trim().toLowerCase(Locale.ROOT);
            int shown = 0;
            for (TabStore.Search term : activity.store.searches) {
                if (shown >= 8 || !term.space.equals(activity.store.active.space)
                        || !term.text.toLowerCase(Locale.ROOT).contains(query)) continue;
                results.addView(option(Kind.SEARCH, term.text, () -> activity.search(term.text)));
                shown++;
            }
            for (TabStore.Page page : activity.store.history) {
                if (!page.space.equals(activity.store.active.space)
                        || !(page.title + " " + page.url).toLowerCase(Locale.ROOT).contains(query)) continue;
                results.addView(option(Kind.GLOBE, page.title, () -> activity.open(page.url, false)));
            }
            if (results.getChildCount() == 0) addTop(results, text("일치하는 기록이 없어요.", 14, muted, false), 8);
        };
        watch(input, draw);
        draw.run();
    }

    private void showPageTools() {
        TabStore.Tab tab = activity.store.active;
        BrowserPage page = activity.activePage();
        if (page == null) return;
        LinearLayout sheet = openPanel("page-tools", "페이지 도구");
        sheet.addView(option(Kind.SEARCH, "페이지에서 찾기", () -> showFind(page)));
        sheet.addView(option(Kind.GLOBE, tab.desktop ? "모바일 사이트로 보기" : "데스크톱 사이트로 보기", () -> {
            tab.desktop = !tab.desktop;
            page.applyDesktopMode(tab.desktop);
            activity.store.save();
            dismissPanel();
            activity.reload();
        }));
        LinearLayout zoom = row();
        zoom.setGravity(Gravity.CENTER_VERTICAL);
        zoom.addView(action("−", soft, ink, () -> { changeZoom(tab, page, -10); showPageTools(); }));
        zoom.addView(action(tab.textZoom + "%", card, ink, () -> { changeZoom(tab, page, 100 - tab.textZoom); showPageTools(); }));
        zoom.addView(action("+", soft, ink, () -> { changeZoom(tab, page, 10); showPageTools(); }));
        addTop(sheet, zoom, 4);
        if (!activity.privateMode()) sheet.addView(option(Kind.FORWARD, "인쇄 또는 PDF로 저장", () -> {
            dismissPanel(); activity.printPage();
        }));
        if (!activity.privateMode() && activity.preferences.getBoolean("showPipTool", true))
            sheet.addView(option(Kind.TABS, "동영상 미니 플레이어", () ->
                    activity.toast("영상을 전체 화면으로 전환한 뒤 홈으로 나가면 작은 창으로 이어집니다.")));
        if (!activity.privateMode() && activity.preferences.getBoolean("showPasswordTool", true))
            sheet.addView(option(Kind.LOCK, "비밀번호 및 자동완성", activity::openAutofill));
    }

    private void changeZoom(TabStore.Tab tab, BrowserPage page, int delta) {
        tab.textZoom = Math.max(75, Math.min(200, tab.textZoom + delta));
        page.getSettings().setTextZoom(tab.textZoom);
        activity.store.save();
    }

    private void showFind(BrowserPage page) {
        LinearLayout sheet = openPanel("find", "페이지에서 찾기");
        findPage = page;
        EditText input = edit("찾을 텍스트", false);
        TextView matches = text("0 / 0", 14, muted, true);
        addTop(sheet, input, 5);
        LinearLayout actions = row();
        actions.setGravity(Gravity.CENTER_VERTICAL);
        actions.addView(matches, new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        actions.addView(iconButton(Kind.BACK, "이전 검색 결과", () -> page.findNext(false)),
                new LinearLayout.LayoutParams(dp(48), dp(48)));
        actions.addView(iconButton(Kind.FORWARD, "다음 검색 결과", () -> page.findNext(true)),
                new LinearLayout.LayoutParams(dp(48), dp(48)));
        addTop(sheet, actions, 6);
        page.setFindListener((index, total, done) -> {
            if (done) matches.setText((total == 0 ? 0 : index + 1) + " / " + total);
        });
        watch(input, () -> {
            String query = input.getText().toString();
            if (query.isEmpty()) { page.clearMatches(); matches.setText("0 / 0"); }
            else page.findAllAsync(query);
        });
        input.requestFocus();
        input.post(() -> {
            if (findPage == page) activity.getSystemService(InputMethodManager.class).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
        });
    }

    void findActive() { if (activity.activePage() != null) showFind(activity.activePage()); }

    void showProfileCard() {
        LinearLayout sheet = openPanel("profile", "내 Orbit 카드");
        EditText name = edit("표시 이름", false);
        EditText tagline = edit("한 줄 소개", false);
        name.setText(activity.preferences.getString("cardName", "Orbit"));
        tagline.setText(activity.preferences.getString("cardTagline", ""));
        OrbitCard preview = new OrbitCard(this);
        sheet.addView(preview, new LinearLayout.LayoutParams(MATCH_PARENT, dp(174)));
        addTop(sheet, name, 10);
        addTop(sheet, tagline, 8);
        Runnable redraw = () -> {
            preview.name = TabStore.label(name.getText().toString(), "Orbit", 36);
            preview.tagline = TabStore.label(tagline.getText().toString(), "", 72);
            preview.invalidate();
        };
        watch(name, redraw);
        watch(tagline, redraw);
        redraw.run();
        addTop(sheet, action("저장 및 PNG 내보내기", accent, onAccent, () -> {
            activity.preferences.edit().putString("cardName", preview.name).putString("cardTagline", preview.tagline).apply();
            activity.files.exportCard(preview.toBitmap());
        }), 10);
    }

    void showHelp() {
        LinearLayout sheet = openPanel("help", "Orbit 사용하기");
        for (String hint : new String[]{"주소창을 누르면 검색어나 웹 주소를 입력할 수 있어요.",
                "탭 버튼을 길게 누르면 새 탭이 열려요.",
                "주소창을 좌우로 밀어 탭을 전환해요.",
                "탭 카드를 길게 눌러 고정하거나 그룹으로 이동해요.",
                "두 페이지를 열고 구분선을 움직여 분할 비율을 조절해요."})
            addTop(sheet, text(hint, 15, ink, false), 12);
    }

    void showSettings() {
        if (!activity.privateMode()) settings = new BrowserSettings(this, openPanel("settings", "설정"));
    }

    void refreshSettings() { if (settings != null) settings.refresh(); }

    boolean backPanel() { return (settings != null && settings.back()) || dismissPanel(); }

    LinearLayout openPanel(String kind, String title) {
        boolean replacing = overlays.getChildCount() > 0;
        dismissPanel(false);
        if (overlays.getChildCount() > 0) {
            PanelLayer closing = (PanelLayer) overlays.getChildAt(0);
            closing.animate().cancel();
            closing.getChildAt(0).animate().cancel();
            removePanelLayer(closing);
        }
        View focused = activity.getCurrentFocus();
        if (focused != null && focused != root) {
            activity.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(focused.getWindowToken(), 0);
            root.requestFocus();
        }
        panelName = kind;
        boolean fixed = kind.equals("settings");
        boolean sidebar = kind.equals("tabs") && activity.getResources().getConfiguration().screenWidthDp >= 600
                && activity.preferences.getString("tabStyle", "cards").equals("list");
        boolean left = activity.preferences.getString("sidebar", "left").equals("left");
        int horizontal = left ? Gravity.START : Gravity.END;
        boolean rtl = root.getLayoutDirection() == View.LAYOUT_DIRECTION_RTL;
        PanelLayer layer = new PanelLayer(sidebar ? dp(left != rtl ? -34 : 34) : 0,
                sidebar ? 0 : dp(fixed ? 10 : 34));
        layer.setBackgroundColor(0x520e091b);
        layer.setOnClickListener(view -> dismissPanel());
        overlays.setVisibility(View.VISIBLE);
        overlays.addView(layer, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));
        panel = layer;
        content.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        controls.setVisibility(kind.equals("search") ? View.GONE : View.VISIBLE);
        LinearLayout sheet = column();
        View container;
        if (fixed) container = sheet;
        else {
            ScrollView scroll = new ScrollView(activity);
            scroll.setVerticalScrollBarEnabled(false);
            scroll.addView(sheet);
            container = scroll;
        }
        container.setBackground(shape(card, radius(24), line));
        container.setClickable(true);
        container.setElevation(dp(8));
        FrameLayout.LayoutParams size = new FrameLayout.LayoutParams(sidebar ?
                dp(activity.preferences.getInt("sidebarWidth", 256)) : MATCH_PARENT,
                fixed || sidebar ? MATCH_PARENT : WRAP_CONTENT, sidebar ? horizontal : Gravity.BOTTOM);
        size.setMargins(dp(8), dp(10), dp(8), dp(8));
        layer.addView(container, size);
        sheet.setPadding(dp(16), dp(10), dp(16), dp(15));
        LinearLayout header = row();
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView heading = text(title, 22, ink, true);
        panelTitle = heading;
        heading.setAccessibilityHeading(true);
        header.addView(heading, new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        header.addView(iconButton(Kind.CLOSE, "닫기", this::dismissPanel),
                new LinearLayout.LayoutParams(dp(48), dp(48)));
        sheet.addView(header);
        if (motionEnabled()) {
            DecelerateInterpolator easing = new DecelerateInterpolator(1.5f);
            if (!replacing) {
                layer.setAlpha(0f);
                layer.animate().alpha(1f).setDuration(210).setInterpolator(easing).start();
            }
            container.setTranslationX(layer.offsetX);
            container.setTranslationY(layer.offsetY);
            container.setAlpha(replacing ? .6f : 1f);
            container.animate().translationX(0f).translationY(0f).alpha(1f)
                    .setDuration(245).setInterpolator(easing).start();
        }
        return sheet;
    }

    boolean dismissPanel() { return dismissPanel(true); }

    private boolean dismissPanel(boolean animate) {
        if (panel == null) return false;
        PanelLayer closing = panel;
        if (findPage != null) {
            findPage.clearMatches();
            findPage.setFindListener(null);
            findPage = null;
        }
        View focused = activity.getCurrentFocus();
        if (focused instanceof EditText) {
            activity.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(focused.getWindowToken(), 0);
            focused.clearFocus();
        }
        searchInput = null;
        panel = null;
        panelName = null;
        panelTitle = null;
        settings = null;
        content.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        closing.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        root.requestFocus();
        View container = closing.getChildAt(0);
        closing.animate().cancel();
        container.animate().cancel();
        if (animate && motionEnabled() && closing.isLaidOut()) {
            AccelerateInterpolator easing = new AccelerateInterpolator();
            container.animate().translationX(closing.offsetX).translationY(closing.offsetY)
                    .setDuration(160).setInterpolator(easing).start();
            closing.animate().alpha(0f).setDuration(160).setInterpolator(easing)
                    .withEndAction(() -> removePanelLayer(closing)).start();
        } else removePanelLayer(closing);
        return true;
    }

    private void removePanelLayer(PanelLayer layer) {
        overlays.removeView(layer);
        if (overlays.getChildCount() == 0) {
            overlays.setVisibility(View.GONE);
            controls.setVisibility(View.VISIBLE);
        }
    }

    private final class PanelLayer extends FrameLayout {
        final int offsetX, offsetY;

        PanelLayer(int offsetX, int offsetY) {
            super(activity);
            this.offsetX = offsetX;
            this.offsetY = offsetY;
        }

        @Override public boolean onInterceptTouchEvent(MotionEvent event) {
            return panel != this || super.onInterceptTouchEvent(event);
        }
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

    int radius(int fallback) {
        String value = activity.preferences.getString("corners", "soft");
        return value.equals("square") ? Math.min(fallback, 6) : value.equals("round") ? fallback + 5 : fallback;
    }

    int mix(int from, int to, float part) {
        return Color.rgb(Math.round(Color.red(from) * (1 - part) + Color.red(to) * part),
                Math.round(Color.green(from) * (1 - part) + Color.green(to) * part),
                Math.round(Color.blue(from) * (1 - part) + Color.blue(to) * part));
    }

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
                shape(fill, radius(radius), 0), shape(Color.WHITE, radius(radius), 0));
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
        row.setMinimumHeight(dp(activity.preferences.getString("density", "comfortable").equals("compact") ? 48 : 53));
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

    EditText edit(String hint, boolean uri) {
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

    void watch(EditText field, Runnable changed) {
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

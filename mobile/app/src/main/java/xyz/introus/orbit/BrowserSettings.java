package xyz.introus.orbit;

import android.content.SharedPreferences;
import android.view.Gravity;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;


import static android.view.ViewGroup.LayoutParams.MATCH_PARENT;
import static android.view.ViewGroup.LayoutParams.WRAP_CONTENT;
import static xyz.introus.orbit.OrbitIcon.Kind;

final class BrowserSettings {
    static final int[] COLORS = {0xff9c83e8, 0xffdb83a0, 0xffd29b69, 0xff6db0ad, 0xff70a4e1};
    static final String[] COLOR_LABELS = {"라벤더", "로즈", "살구", "민트", "파랑"};
    private final BrowserChrome chrome;
    private final BrowserActivity activity;
    private final SharedPreferences prefs;
    private final LinearLayout navigation, body;
    private final ScrollView scroll;
    private int category;
    private boolean inChoice;
    private int savedScroll;

    BrowserSettings(BrowserChrome chrome, LinearLayout surface) {
        this.chrome = chrome;
        activity = chrome.activity;
        prefs = activity.preferences;
        HorizontalScrollView categories = new HorizontalScrollView(activity);
        categories.setHorizontalScrollBarEnabled(false);
        navigation = chrome.row();
        categories.addView(navigation);
        chrome.addTop(surface, categories, 4);
        scroll = new ScrollView(activity);
        scroll.setFillViewport(false);
        body = chrome.column();
        body.setPadding(0, chrome.dp(10), 0, chrome.dp(18));
        scroll.addView(body);
        surface.addView(scroll, new LinearLayout.LayoutParams(MATCH_PARENT, 0, 1));
        refresh();
    }

    void refresh() {
        navigation.removeAllViews();
        String[] sections = {"일반", "꾸미기", "검색", "개인정보", "정보"};
        for (int index = 0; index < sections.length; index++) {
            int selected = index;
            TextView tab = chrome.action(sections[index], index == category ? chrome.accent : chrome.soft,
                    index == category ? chrome.onAccent : chrome.ink, () -> {
                        category = selected;
                        inChoice = false;
                        refresh();
                        scroll.scrollTo(0, 0);
                    });
            tab.setSelected(index == category);
            LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT);
            size.setMarginEnd(chrome.dp(6));
            navigation.addView(tab, size);
        }
        drawCategory();
    }

    boolean back() {
        if (!inChoice) return false;
        drawCategory();
        scroll.post(() -> scroll.scrollTo(0, savedScroll));
        return true;
    }

    private void drawCategory() {
        inChoice = false;
        body.removeAllViews();
        switch (category) {
            case 1: appearance(); break;
            case 2: search(); break;
            case 3: privacy(); break;
            case 4: about(); break;
            default: general();
        }
    }

    private void general() {
        heading("탭과 주소창");
        toggle("새 탭에서 검색창 바로 열기", "focusNewTab", true);
        toggle("탭 카드에 닫기 버튼 표시", "showTabClose", true);
        option("탭 전환 방식", "tabStyle", "cards", new String[]{"cards", "list"}, new String[]{"카드", "목록"});
        option("주소창 위치", "toolbarPosition", "bottom", new String[]{"bottom", "top"}, new String[]{"하단", "상단"});
        option("분할 방향", "splitDirection", "auto", new String[]{"auto", "stacked", "side"},
                new String[]{"화면 크기에 따라", "위아래", "좌우"});
        option("탭 라이브러리 위치", "sidebar", "left", new String[]{"left", "right"}, new String[]{"왼쪽", "오른쪽"});
        slider("탭 라이브러리 너비", "sidebarWidth", 256, 200, 360, "dp");
        heading("도구 모음");
        toggle("탭 검색 표시", "showTabSearchTool", true);
        toggle("즐겨찾기 표시", "showFavoriteTool", true);
        toggle("분할 화면 표시", "showSplitTool", true);
        toggle("비밀번호 및 자동완성 표시", "showPasswordTool", true);
        toggle("미니 플레이어 표시", "showPipTool", true);
        toggle("전체 화면 영상을 미니 플레이어로 이어 보기", "autoPip", true);
        heading("Android");
        entry("기본 브라우저로 설정", "Android에서 Orbit으로 웹 링크를 열도록 선택합니다.", activity::requestDefaultBrowser);
        entry("다운로드", "Android 다운로드 목록을 엽니다.", activity::downloads);
    }

    private void appearance() {
        heading("색과 모양");
        option("테마", "theme", "system", new String[]{"system", "light", "dark", "space"},
                new String[]{"시스템 설정", "밝게", "어둡게", "스페이스 색상"});
        entry("강조색", "선택 버튼, 탭 표시와 링크에 적용합니다.", this::accents);
        option("간격", "density", "comfortable", new String[]{"comfortable", "compact"}, new String[]{"여유롭게", "촘촘하게"});
        option("모서리", "corners", "soft", new String[]{"soft", "square", "round"}, new String[]{"부드럽게", "각지게", "둥글게"});
        toggle("꾸미기 프리셋 표시", "showPresets", true);
        if (prefs.getBoolean("showPresets", true)) entry("꾸미기 프리셋", "라벤더, 미니멀, 시스템", this::presets);
        toggle("화면 전환 애니메이션", "animations", true);
        heading("시작 페이지");
        backgrounds();
        entry("개인 사진 선택", "JPG 또는 PNG를 시작 페이지 배경으로 사용합니다.", activity.files::chooseImage);
        slider("배경 어둡기", "overlay", 35, 0, 85, "%");
        toggle("시계 표시", "showClock", true);
        option("시계 글자", "clockStyle", "gradient", new String[]{"gradient", "plain"}, new String[]{"그라데이션", "흰색"});
        toggle("서울 날씨 표시", "showWeather", true);
        toggle("서울 실시간 날씨 사용", "onlineWeather", true);
        toggle("바로가기 표시", "showShortcuts", true);
        option("바로가기 크기", "dialSize", "medium", new String[]{"small", "medium", "large"}, new String[]{"작게", "보통", "크게"});
        toggle("최근 방문 표시", "showDashboard", true);
        heading("꾸미기 파일");
        entry("꾸미기 설정 내보내기", "Orbit 꾸미기 JSON 파일로 저장합니다.", activity.files::exportAppearance);
        entry("꾸미기 설정 가져오기", "Windows 또는 Android Orbit에서 저장한 파일을 엽니다.", activity.files::importAppearance);
    }

    private void search() {
        heading("검색");
        WebAddress.SearchEngine[] engines = WebAddress.SearchEngine.values();
        entry("검색 엔진", activity.searchEngine().label, () -> {
            beginChoice("검색 엔진");
            for (WebAddress.SearchEngine engine : engines) {
                boolean checked = engine == activity.searchEngine();
                choose(engine.label, checked, () -> change("engine", engine.name()), engine.name().toLowerCase(java.util.Locale.ROOT));
            }
        });
        toggle("주소창 자동완성", "autocomplete", true);
        toggle("검색·방문 기록 저장", "saveHistory", true);
        toggle("Google 추천 검색어", "onlineSuggestions", false);
        detail("Google 추천 검색어를 켜면 Google 검색 엔진을 쓸 때 주소창에 입력한 검색어가 Google에 전송됩니다.");
        entry("검색·방문 기록", "현재 스페이스의 방문 기록을 찾아봅니다.", chrome::showHistory);
    }

    private void privacy() {
        heading("브라우징 데이터");
        entry("시크릿 창 열기", "일반 탭과 분리된 저장소에서 열립니다.", activity::openPrivate);
        entry("비밀번호 및 자동완성", "Android에서 지정한 자동완성 서비스 설정을 엽니다.", activity::openAutofill);
        entry("현재 스페이스 사이트 데이터 삭제", "사이트의 쿠키와 웹 저장소를 삭제하고 로그인 상태를 해제합니다.",
                () -> confirm("사이트 데이터 삭제", "현재 스페이스의 쿠키와 웹 저장소가 지워집니다.", activity::clearSiteData));
        entry("검색·방문 기록 삭제", "현재 스페이스의 방문 기록과 최근 검색어를 지웁니다.",
                () -> confirm("기록 삭제", "현재 스페이스의 방문 기록과 최근 검색어를 지울까요?", () -> {
                    activity.store.history.removeIf(page -> page.space.equals(activity.store.active.space));
                    activity.store.searches.removeIf(entry -> entry.space.equals(activity.store.active.space));
                    activity.store.save();
                    activity.toast("기록을 지웠어요.");
                }));
        heading("가져오기와 내보내기");
        entry("즐겨찾기 가져오기", "브라우저 북마크 HTML 또는 Chromium JSON 파일을 선택합니다.", activity.files::importBookmarks);
        entry("탭과 즐겨찾기 내보내기", "열린 탭과 즐겨찾기의 제목·주소를 JSON으로 저장합니다.", activity.files::exportLinks);
    }

    private void about() {
        heading("Orbit Mobile " + BuildConfig.VERSION_NAME);
        detail("悠月 · 유월 · Yuwol이 개인으로 제작하는 브라우저입니다.");
        LinearLayout signatures = chrome.column();
        signatures.setPadding(chrome.dp(12), chrome.dp(10), chrome.dp(12), chrome.dp(10));
        signatures.setBackground(chrome.shape(0xff23192f, chrome.radius(20), 0));
        signature(signatures, "brand/yuwol-lavender.png", "Yuwol 라벤더 별빛 사인");
        signature(signatures, "brand/yuwol-crescent.png", "유월 파스텔 초승달 사인");
        chrome.addTop(body, signatures, 8);
        entry("내 Orbit 카드", "이름과 한 줄 소개를 꾸미고 PNG로 저장합니다.", chrome::showProfileCard);
        entry("Orbit 홈페이지", "소개 사이트와 출시 정보를 엽니다.", () -> activity.open("https://orbit.intro-us.xyz/", true));
        entry("도움말", "모바일 조작 방법을 확인합니다.", chrome::showHelp);
        heading("저장과 날씨");
        detail("일반 탭, 설정과 로그인 데이터는 이 기기에 저장됩니다. 서울 날씨 사용 시 Open-Meteo에 고정 서울 좌표를 요청합니다.");
        entry("Open-Meteo", "날씨 데이터 제공처", () -> activity.open("https://open-meteo.com/", true));
    }

    private void signature(LinearLayout parent, String asset, String label) {
        ImageView image = new ImageView(activity);
        image.setImageBitmap(chrome.image(asset));
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setContentDescription(label);
        parent.addView(image, new LinearLayout.LayoutParams(MATCH_PARENT, chrome.dp(82)));
    }

    private void backgrounds() {
        String[] values = {"auto", "day", "night", "rain", "snow", "solid", "custom"};
        String[] labels = {"서울 날씨와 시각", "낮", "밤", "비", "눈", "단색", "개인 사진"};
        int index = position(values, prefs.getString("scene", "auto"));
        entry("시작 페이지 배경", labels[index], () -> {
            beginChoice("시작 페이지 배경");
            for (int item = 0; item < values.length; item++) {
                String value = values[item];
                boolean selected = value.equals(prefs.getString("scene", "auto"));
                choose(labels[item], selected, () -> {
                    if (value.equals("custom") && !prefs.contains("customImage")) activity.files.chooseImage();
                    else change("scene", value);
                }, item >= 1 && item <= 4 ? "wallpapers/seoul-" + value + ".jpg" : null);
            }
            entry("단색 배경 색상", "색상 팔레트에서 선택합니다.", () -> palette("단색 배경", "backgroundColor", 0xff222237));
        });
    }

    private void accents() { palette("강조색", "accent", 0); }

    private void palette(String title, String key, int fallback) {
        beginChoice(title);
        int current = prefs.getInt(key, fallback);
        choose("기본 색상", current == fallback, () -> {
            prefs.edit().putInt(key, fallback).apply();
            appearanceChanged();
        }, null);
        for (int index = 0; index < COLORS.length; index++) {
            int color = COLORS[index];
            choose(COLOR_LABELS[index], current == color, () -> {
                prefs.edit().putInt(key, color).apply();
                appearanceChanged();
            }, null);
        }
    }

    private void presets() {
        beginChoice("꾸미기 프리셋");
        entry("라벤더", "어두운 화면, 라벤더 강조색, 둥근 모서리", () -> preset("dark", COLORS[0], "round", "comfortable"));
        entry("미니멀", "밝은 화면, 작은 간격, 각진 모서리", () -> preset("light", 0, "square", "compact"));
        entry("시스템", "시스템 테마, 기본 모서리와 간격", () -> preset("system", 0, "soft", "comfortable"));
    }

    private void preset(String theme, int accent, String corners, String density) {
        prefs.edit().putString("theme", theme).putInt("accent", accent)
                .putString("corners", corners).putString("density", density).apply();
        appearanceChanged();
    }

    private void option(String title, String key, String fallback, String[] values, String[] labels) {
        int selected = position(values, prefs.getString(key, fallback));
        entry(title, labels[selected], () -> {
            beginChoice(title);
            for (int index = 0; index < values.length; index++) {
                String value = values[index];
                choose(labels[index], index == selected, () -> change(key, value), null);
            }
        });
    }

    private int position(String[] values, String value) {
        for (int i = 0; i < values.length; i++) if (values[i].equals(value)) return i;
        return 0;
    }

    private void change(String key, String value) {
        prefs.edit().putString(key, value).apply();
        appearanceChanged();
    }

    private void appearanceChanged() {
        chrome.updateTheme();
        activity.renderActive();
        boolean returnToCategory = inChoice;
        refresh();
        if (returnToCategory) scroll.post(() -> scroll.scrollTo(0, savedScroll));
    }

    private void beginChoice(String title) {
        if (!inChoice) savedScroll = scroll.getScrollY();
        inChoice = true;
        body.removeAllViews();
        chrome.addTop(body, chrome.option(Kind.BACK, "설정으로 돌아가기", this::back), 0);
        heading(title);
        scroll.scrollTo(0, 0);
    }

    private void choose(String label, boolean checked, Runnable action, String image) {
        LinearLayout row = chrome.row();
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(chrome.dp(57));
        row.setPadding(chrome.dp(12), chrome.dp(7), chrome.dp(12), chrome.dp(7));
        row.setBackground(chrome.actionSurface(checked ? chrome.soft : chrome.card, 15));
        if (image != null) {
            ImageView icon = new ImageView(activity);
            String path = image.equals("google") || image.equals("naver") ? "sites/" + image + ".png" : image;
            icon.setImageBitmap(chrome.image(path));
            icon.setScaleType(ImageView.ScaleType.CENTER_CROP);
            LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(chrome.dp(38), chrome.dp(34));
            size.setMarginEnd(chrome.dp(10));
            if (!image.equals("duckduckgo")) row.addView(icon, size);
        }
        row.addView(chrome.text(label, 16, chrome.ink, true), new LinearLayout.LayoutParams(0, WRAP_CONTENT, 1));
        TextView mark = chrome.text(checked ? "✓" : "○", 19, checked ? chrome.accent : chrome.muted, true);
        row.addView(mark);
        row.setContentDescription(label + (checked ? ", 선택됨" : ""));
        row.setSelected(checked);
        row.setOnClickListener(view -> action.run());
        chrome.addTop(body, row, 7);
    }

    private void heading(String value) {
        TextView heading = chrome.text(value, 17, chrome.accent, true);
        heading.setAccessibilityHeading(true);
        chrome.addTop(body, heading, body.getChildCount() == 0 ? 2 : 18);
    }

    private void detail(String value) { chrome.addTop(body, chrome.text(value, 13, chrome.muted, false), 7); }

    private void entry(String title, String detail, Runnable action) {
        LinearLayout row = chrome.column();
        row.setPadding(chrome.dp(13), chrome.dp(10), chrome.dp(13), chrome.dp(10));
        row.setMinimumHeight(chrome.dp(55));
        row.setBackground(chrome.actionSurface(chrome.card, 14));
        row.addView(chrome.text(title, 15, chrome.ink, true));
        if (detail != null) chrome.addTop(row, chrome.text(detail, 13, chrome.muted, false), 3);
        row.setContentDescription(title + (detail == null ? "" : ", " + detail));
        row.setOnClickListener(view -> action.run());
        chrome.addTop(body, row, 7);
    }

    private void toggle(String title, String key, boolean fallback) {
        Switch toggle = new Switch(activity);
        toggle.setText(title);
        toggle.setTextColor(chrome.ink);
        toggle.setTextSize(15);
        toggle.setMinHeight(chrome.dp(52));
        toggle.setPadding(chrome.dp(12), chrome.dp(6), chrome.dp(12), chrome.dp(6));
        toggle.setBackground(chrome.shape(chrome.card, chrome.radius(14), 0));
        android.content.res.ColorStateList tint = new android.content.res.ColorStateList(
                new int[][]{new int[]{android.R.attr.state_checked}, new int[]{}},
                new int[]{chrome.accent, chrome.muted});
        toggle.setThumbTintList(tint);
        toggle.setTrackTintList(android.content.res.ColorStateList.valueOf(chrome.soft));
        toggle.setChecked(prefs.getBoolean(key, fallback));
        toggle.setOnCheckedChangeListener((button, checked) -> {
            prefs.edit().putBoolean(key, checked).apply();
            activity.renderActive();
            if (key.equals("showPresets")) refresh();
        });
        chrome.addTop(body, toggle, 6);
    }

    private void slider(String title, String key, int fallback, int min, int max, String unit) {
        LinearLayout box = chrome.column();
        box.setPadding(chrome.dp(12), chrome.dp(9), chrome.dp(12), chrome.dp(5));
        box.setBackground(chrome.shape(chrome.card, chrome.radius(14), 0));
        int current = prefs.getInt(key, fallback);
        TextView label = chrome.text(title + " · " + current + unit, 15, chrome.ink, true);
        box.addView(label);
        SeekBar slider = new SeekBar(activity);
        slider.setContentDescription(title);
        slider.setMax(max - min);
        slider.setProgress(current - min);
        slider.setProgressTintList(android.content.res.ColorStateList.valueOf(chrome.accent));
        slider.setThumbTintList(android.content.res.ColorStateList.valueOf(chrome.accent));
        box.addView(slider, new LinearLayout.LayoutParams(MATCH_PARENT, chrome.dp(42)));
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean user) {
                label.setText(title + " · " + (min + progress) + unit);
                if (user) prefs.edit().putInt(key, min + progress).apply();
            }
            @Override public void onStartTrackingTouch(SeekBar bar) { }
            @Override public void onStopTrackingTouch(SeekBar bar) { activity.renderActive(); }
        });
        chrome.addTop(body, box, 7);
    }

    private void confirm(String title, String text, Runnable action) {
        beginChoice(title);
        detail(text);
        chrome.addTop(body, chrome.action("삭제", chrome.accent, chrome.onAccent, () -> { action.run(); back(); }), 14);
    }
}

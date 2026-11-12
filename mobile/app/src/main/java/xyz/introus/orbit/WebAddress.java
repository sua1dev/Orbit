package xyz.introus.orbit;

import java.io.UnsupportedEncodingException;
import java.net.IDN;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.util.Locale;

final class WebAddress {
    enum SearchEngine {
        GOOGLE("Google", "https://www.google.com/search?q="),
        NAVER("네이버", "https://search.naver.com/search.naver?query="),
        DUCKDUCKGO("DuckDuckGo", "https://duckduckgo.com/?q=");

        final String label;
        final String prefix;

        SearchEngine(String label, String prefix) {
            this.label = label;
            this.prefix = prefix;
        }
    }

    private WebAddress() {}

    static String resolve(String input, SearchEngine engine) {
        String query = input.trim();
        if (query.isEmpty() || query.length() > 8192) return null;
        if (query.regionMatches(true, 0, "http://", 0, 7)
                || query.regionMatches(true, 0, "https://", 0, 8)) {
            return normalize(query);
        }
        if (!query.contains("://") && !query.matches("(?s).*\\s.*")) {
            String authority = query.split("[/?#]", 2)[0];
            String host = authority.startsWith("[") ? authority : authority.split(":", 2)[0];
            boolean local = host.equalsIgnoreCase("localhost") || host.startsWith("[")
                    || host.matches("\\d{1,3}(?:\\.\\d{1,3}){3}");
            if (local || host.contains(".") || host.contains("。")) {
                String address = normalize((local ? "http://" : "https://") + query);
                if (address != null) return address;
            }
        }
        try {
            return engine.prefix + URLEncoder.encode(query, "UTF-8");
        } catch (UnsupportedEncodingException impossible) {
            throw new AssertionError(impossible);
        }
    }

    static String normalize(String input) {
        if (input == null || input.length() > 8192 || input.indexOf('\\') >= 0) return null;
        try {
            URI uri = new URI(input);
            String scheme = uri.getScheme();
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return null;
            String authority = uri.getRawAuthority();
            if (authority == null || authority.isEmpty() || authority.contains("@") || authority.contains("%")) return null;

            String host = uri.getHost();
            int port = uri.getPort();
            if (host == null) {
                int colon = authority.lastIndexOf(':');
                String name = colon < 0 ? authority : authority.substring(0, colon);
                if (colon >= 0) {
                    String portText = authority.substring(colon + 1);
                    if (!portText.matches("[0-9]+")) return null;
                    port = Integer.parseInt(portText);
                }
                host = IDN.toASCII(name, IDN.USE_STD3_ASCII_RULES);
            }
            if (host.isEmpty() || port == 0 || port < -1 || port > 65535) return null;
            StringBuilder normalized = new StringBuilder(scheme.toLowerCase(Locale.ROOT))
                    .append("://").append(host.toLowerCase(Locale.ROOT));
            if (port > 0) normalized.append(':').append(port);
            String path = uri.getRawPath();
            normalized.append(path == null || path.isEmpty() ? "/" : path);
            if (uri.getRawQuery() != null) normalized.append('?').append(uri.getRawQuery());
            if (uri.getRawFragment() != null) normalized.append('#').append(uri.getRawFragment());
            return new URI(normalized.toString()).toASCIIString();
        } catch (IllegalArgumentException | URISyntaxException invalid) {
            return null;
        }
    }

    static String displayHost(String url) {
        if (url == null) return "";
        try {
            URI uri = new URI(url);
            String host = uri.getHost();
            if (host == null) return "";
            if (host.startsWith("www.")) host = host.substring(4);
            return uri.getPort() > 0 ? host + ":" + uri.getPort() : host;
        } catch (URISyntaxException invalid) {
            return "";
        }
    }
}

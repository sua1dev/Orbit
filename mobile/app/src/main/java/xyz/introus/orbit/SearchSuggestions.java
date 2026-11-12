package xyz.introus.orbit;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

final class SearchSuggestions {
    private static final ExecutorService NETWORK = Executors.newSingleThreadExecutor();

    private SearchSuggestions() {}

    static void request(String query, Consumer<List<String>> done) {
        NETWORK.execute(() -> done.accept(fetch(query)));
    }

    private static List<String> fetch(String query) {
        List<String> results = new ArrayList<>();
        HttpURLConnection connection = null;
        try {
            URL url = new URL("https://suggestqueries.google.com/complete/search?client=firefox&q="
                    + URLEncoder.encode(query, "UTF-8"));
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(2200);
            connection.setReadTimeout(2200);
            connection.setInstanceFollowRedirects(false);
            if (connection.getResponseCode() != 200) return results;
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 24_000) return results;
                    bytes.write(buffer, 0, count);
                }
                JSONArray values = new JSONArray(new String(bytes.toByteArray(), StandardCharsets.UTF_8)).optJSONArray(1);
                if (values != null) for (int i = 0; i < Math.min(4, values.length()); i++) {
                    String value = values.optString(i).trim();
                    if (!value.isEmpty() && value.length() <= 160 && !value.equals(query)) results.add(value);
                }
            }
        } catch (Exception unavailable) {
            // Local suggestions remain available when the optional service fails.
        } finally { if (connection != null) connection.disconnect(); }
        return results;
    }
}

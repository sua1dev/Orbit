package xyz.introus.orbit;

import android.os.SystemClock;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

final class SeoulWeather {
    static final class Reading {
        final String scene, description;
        final int temperature;
        Reading(String scene, String description, int temperature) {
            this.scene = scene; this.description = description; this.temperature = temperature;
        }
    }

    private static final String FORECAST = "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978"
            + "&current=temperature_2m,is_day,weather_code,rain,showers,snowfall&timezone=Asia%2FSeoul";
    private static final Executor WORKER = Executors.newSingleThreadExecutor();
    private static long expires;
    private static Reading reading;
    private static boolean busy;

    private SeoulWeather() {}

    static synchronized Reading current() {
        return SystemClock.elapsedRealtime() < expires ? reading : null;
    }

    static synchronized void update(Runnable done) {
        if (busy || SystemClock.elapsedRealtime() < expires) return;
        busy = true;
        WORKER.execute(() -> {
            Reading latest = fetch();
            synchronized (SeoulWeather.class) {
                reading = latest;
                expires = SystemClock.elapsedRealtime() + (latest == null ? 4 : 15) * 60_000L;
                busy = false;
            }
            done.run();
        });
    }

    private static Reading fetch() {
        HttpURLConnection request = null;
        try {
            request = (HttpURLConnection) new URL(FORECAST).openConnection();
            request.setConnectTimeout(3500);
            request.setReadTimeout(3500);
            request.setInstanceFollowRedirects(false);
            if (request.getResponseCode() != 200) return null;
            byte[] buffer = new byte[4096];
            try (InputStream input = request.getInputStream();
                 java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 24_000) return null;
                    bytes.write(buffer, 0, count);
                }
                JSONObject current = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8))
                        .getJSONObject("current");
                return interpret(current);
            }
        } catch (Exception failure) {
            return null;
        } finally { if (request != null) request.disconnect(); }
    }

    private static Reading interpret(JSONObject current) {
        int code = current.optInt("weather_code", -1);
        int daylight = current.optInt("is_day", -1);
        double temp = current.optDouble("temperature_2m");
        if (code < 0 || daylight < 0 || !Double.isFinite(temp)) return null;
        boolean snow = current.optDouble("snowfall", 0) > 0 || (code >= 71 && code <= 77) || code == 85 || code == 86;
        boolean rain = current.optDouble("rain", 0) > 0 || current.optDouble("showers", 0) > 0
                || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
        String scene = snow ? "snow" : rain ? "rain" : daylight == 1 ? "day" : "night";
        String name = snow ? "눈" : rain ? "비" : code >= 45 ? "안개" : code >= 2 ? "흐림" : "맑음";
        return new Reading(scene, name, (int) Math.round(temp));
    }
}

package xyz.introus.orbit;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Iterator;
import java.util.stream.Stream;

public final class PrivateCleanupReceiver extends BroadcastReceiver {
    static final String SUFFIX = "orbit_private";

    @Override public void onReceive(Context context, Intent intent) {
        PendingResult result = goAsync();
        new Thread(() -> {
            try {
                for (int attempt = 0; attempt < 12; attempt++) {
                    try (RandomAccessFile file = lockFile(context);
                         FileLock lock = file.getChannel().tryLock()) {
                        if (lock != null) { erase(context); return; }
                    } catch (IOException | java.nio.channels.OverlappingFileLockException ignored) {
                        // The private process can still be exiting.
                    }
                    Thread.sleep(140);
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } finally {
                result.finish();
            }
        }, "Orbit private cleanup").start();
    }

    static RandomAccessFile lockFile(Context context) throws IOException {
        return new RandomAccessFile(new File(context.getNoBackupFilesDir(), "orbit-private.lock"), "rw");
    }

    static void erase(Context context) throws IOException {
        deleteTree(new File(context.getDataDir(), "app_webview_" + SUFFIX));
        deleteTree(new File(context.getCacheDir(), "WebView_" + SUFFIX));
    }

    private static void deleteTree(File directory) throws IOException {
        Path path = directory.toPath();
        if (!Files.exists(path, java.nio.file.LinkOption.NOFOLLOW_LINKS)) return;
        try (Stream<Path> paths = Files.walk(path)) {
            Iterator<Path> children = paths.sorted(Comparator.reverseOrder()).iterator();
            while (children.hasNext()) Files.deleteIfExists(children.next());
        }
    }
}

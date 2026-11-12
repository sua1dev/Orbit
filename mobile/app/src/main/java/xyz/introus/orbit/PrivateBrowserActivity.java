package xyz.introus.orbit;

import android.content.Intent;
import android.os.Bundle;
import android.os.Process;
import android.view.WindowManager;
import android.webkit.WebView;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;

public final class PrivateBrowserActivity extends BrowserActivity {
    private static RandomAccessFile lockFile;
    private static FileLock lock;

    @Override protected void onCreate(Bundle state) {
        if (lock == null) {
            try {
                lockFile = PrivateCleanupReceiver.lockFile(this);
                lock = lockFile.getChannel().lock();
                PrivateCleanupReceiver.erase(this);
                WebView.setDataDirectorySuffix(PrivateCleanupReceiver.SUFFIX);
                WebView.setWebContentsDebuggingEnabled(false);
            } catch (IOException | RuntimeException failure) {
                android.util.Log.e("Orbit", "Could not initialize isolated WebView storage", failure);
                super.onCreate(null);
                toast("시크릿 저장소를 준비할 수 없어요.");
                finishAndRemoveTask();
                return;
            }
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        super.onCreate(null);
    }

    @Override boolean privateMode() { return true; }

    @Override protected void onDestroy() {
        super.onDestroy();
        if (isFinishing()) {
            sendBroadcast(new Intent(this, PrivateCleanupReceiver.class));
            Process.killProcess(Process.myPid());
        }
    }
}

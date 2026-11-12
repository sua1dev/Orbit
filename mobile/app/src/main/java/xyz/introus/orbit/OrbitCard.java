package xyz.introus.orbit;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.View;

@SuppressLint("ViewConstructor")
final class OrbitCard extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint text = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Bitmap logo;
    String name = "Orbit", tagline = "";

    OrbitCard(BrowserChrome chrome) {
        super(chrome.activity);
        logo = chrome.image("orbit.png");
        setContentDescription("Orbit 카드 미리보기");
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        drawCard(canvas, getWidth(), getHeight());
    }

    Bitmap toBitmap() {
        Bitmap result = Bitmap.createBitmap(960, 540, Bitmap.Config.ARGB_8888);
        drawCard(new Canvas(result), result.getWidth(), result.getHeight());
        return result;
    }

    private void drawCard(Canvas canvas, int width, int height) {
        if (width < 1 || height < 1) return;
        float unit = Math.min(width / 960f, height / 540f);
        canvas.save();
        canvas.translate((width - 960 * unit) / 2, (height - 540 * unit) / 2);
        canvas.scale(unit, unit);
        paint.setShader(new LinearGradient(0, 0, 960, 540, 0xff211633, 0xff6d4799, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(0, 0, 960, 540, 42, 42, paint);
        paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2);
        paint.setColor(0x74e5c9ff);
        canvas.save();
        canvas.rotate(-27, 755, 218);
        for (int i = 0; i < 4; i++) canvas.drawOval(580 - i * 20, 152 - i * 15, 930 + i * 12, 285 + i * 16, paint);
        canvas.restore();
        paint.setStyle(Paint.Style.FILL);
        if (logo != null) canvas.drawBitmap(logo, null, new android.graphics.Rect(54, 50, 138, 134), paint);
        text.setColor(0xffe8d5ff);
        text.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        text.setTextSize(32);
        canvas.drawText("Orbit", 158, 104, text);
        text.setColor(Color.WHITE);
        text.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        text.setTextSize(74);
        canvas.drawText(TextUtils.ellipsize(name, text, 760, TextUtils.TruncateAt.END).toString(), 54, 360, text);
        text.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        text.setTextSize(31);
        text.setColor(0xfff2e3ff);
        canvas.drawText(TextUtils.ellipsize(tagline, text, 850, TextUtils.TruncateAt.END).toString(), 57, 420, text);
        canvas.restore();
    }
}

package xyz.introus.orbit;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;

final class OrbitIcon extends Drawable {
    enum Kind { SEARCH, TABS, PLUS, MORE, BACK, FORWARD, RELOAD, CLOSE, STAR, SHARE, SETTINGS, GLOBE, LOCK, HOME }

    private final Kind kind;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final int size;

    OrbitIcon(Kind kind, int color, int size) {
        this.kind = kind;
        this.size = size;
        paint.setColor(color);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(1.75f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
    }

    @Override public void draw(Canvas canvas) {
        Rect bounds = getBounds();
        canvas.save();
        canvas.translate(bounds.left, bounds.top);
        canvas.scale(bounds.width() / 24f, bounds.height() / 24f);
        switch (kind) {
            case SEARCH:
                canvas.drawCircle(10.4f, 10.4f, 5.7f, paint);
                line(canvas, 14.8f, 14.8f, 19.5f, 19.5f);
                break;
            case TABS:
                canvas.drawRoundRect(6, 6, 19, 20, 3, 3, paint);
                path(canvas, 4, 15, 4, 6, 5, 4, 15, 4);
                break;
            case PLUS:
                line(canvas, 5, 12, 19, 12);
                line(canvas, 12, 5, 12, 19);
                break;
            case MORE:
                paint.setStyle(Paint.Style.FILL);
                for (int x = 5; x <= 19; x += 7) canvas.drawCircle(x, 12, 1.5f, paint);
                paint.setStyle(Paint.Style.STROKE);
                break;
            case BACK:
            case FORWARD:
                if (kind == Kind.FORWARD) {
                    canvas.translate(24, 0);
                    canvas.scale(-1, 1);
                }
                path(canvas, 11, 5, 4, 12, 11, 19);
                line(canvas, 4, 12, 20, 12);
                break;
            case RELOAD:
                canvas.drawArc(5, 5, 19, 19, 35, 295, false, paint);
                path(canvas, 15, 9, 19, 9, 19, 4);
                break;
            case CLOSE:
                line(canvas, 6, 6, 18, 18);
                line(canvas, 18, 6, 6, 18);
                break;
            case STAR:
                path(canvas, 12, 3, 14.8f, 8.8f, 21, 9.8f, 16.5f, 14.2f, 17.5f, 20.6f,
                        12, 17.7f, 6.5f, 20.6f, 7.5f, 14.2f, 3, 9.8f, 9.2f, 8.8f, 12, 3);
                break;
            case SHARE:
                canvas.drawCircle(6, 12, 2.5f, paint);
                canvas.drawCircle(18, 5, 2.5f, paint);
                canvas.drawCircle(18, 19, 2.5f, paint);
                line(canvas, 8.2f, 10.7f, 15.8f, 6.3f);
                line(canvas, 8.2f, 13.3f, 15.8f, 17.7f);
                break;
            case SETTINGS:
                line(canvas, 4, 6, 20, 6);
                line(canvas, 4, 12, 20, 12);
                line(canvas, 4, 18, 20, 18);
                line(canvas, 9, 3, 9, 9);
                line(canvas, 15, 9, 15, 15);
                line(canvas, 10, 15, 10, 21);
                break;
            case GLOBE:
                canvas.drawCircle(12, 12, 8, paint);
                canvas.drawOval(8, 4, 16, 20, paint);
                line(canvas, 4, 12, 20, 12);
                break;
            case LOCK:
                canvas.drawRoundRect(5.5f, 10, 18.5f, 20, 2.2f, 2.2f, paint);
                canvas.drawArc(8, 4, 16, 12, 180, 180, false, paint);
                line(canvas, 8, 8, 8, 10);
                line(canvas, 16, 8, 16, 10);
                break;
            case HOME:
                path(canvas, 4, 11, 12, 4, 20, 11, 18, 11, 18, 20, 6, 20, 6, 11, 4, 11);
                break;
        }
        canvas.restore();
    }

    private void line(Canvas canvas, float x1, float y1, float x2, float y2) {
        canvas.drawLine(x1, y1, x2, y2, paint);
    }

    private void path(Canvas canvas, float... points) {
        Path path = new Path();
        path.moveTo(points[0], points[1]);
        for (int i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
        canvas.drawPath(path, paint);
    }

    @Override public int getIntrinsicWidth() { return size; }
    @Override public int getIntrinsicHeight() { return size; }
    @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
}

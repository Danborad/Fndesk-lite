#!/usr/bin/env python3
"""Fndesk Lite — 图标生成脚本

从 docs/icon-source.png（原始设计图，带外围留白与投影）裁切出圆角图标本体，
再生成飞牛套件与网页所需的全套尺寸。

用法：python3 tools/make-icons.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "icon-source.png")

# 设计图中图标本体的外沿（蓝色圆角方框）像素坐标
CROP_BOX = (166, 139, 1088, 1076)
# 圆角半径比例（约等于 iOS Squircle 视觉半径）
CORNER_RATIO = 0.215
# 超采样倍率，保证圆角边缘平滑
SS = 4


def build_master():
    src = Image.open(SRC).convert("RGBA")
    crop = src.crop(CROP_BOX)
    w, h = crop.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - w) // 2, (side - h) // 2), crop)

    mask = Image.new("L", (side * SS, side * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, side * SS - 1, side * SS - 1],
        radius=int(side * CORNER_RATIO * SS),
        fill=255,
    )
    mask = mask.resize((side, side), Image.LANCZOS)
    canvas.putalpha(
        Image.composite(canvas.getchannel("A"), Image.new("L", (side, side), 0), mask)
    )
    return canvas


def save(img, relpath, size):
    path = os.path.join(ROOT, relpath)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print(f"  {relpath:<44} {size}x{size}")


def main():
    master = build_master()
    print(f"[icons] master {master.size[0]}px")
    save(master, "ICON.PNG", 256)
    save(master, "ICON_256.PNG", 256)
    save(master, "app/server/static/icon.png", 256)
    save(master, "app/ui/images/icon_256.png", 256)
    save(master, "app/ui/images/icon_64.png", 64)
    # 版本化图标目录：桌面端会长期缓存 icon_{0}.png 这个 URL，
    # 换图标时递增此目录即可强制客户端重新拉取。
    save(master, "app/ui/images/v250/icon_256.png", 256)
    save(master, "app/ui/images/v250/icon_128.png", 128)
    save(master, "app/ui/images/v250/icon_64.png", 64)
    save(master, "app/server/fndesk_app/ICON.PNG", 256)
    save(master, "app/server/fndesk_app/ICON_256.PNG", 256)
    save(master, "docs/icon.png", 512)
    # favicon
    ico = os.path.join(ROOT, "app/server/favicon.ico")
    master.save(ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print(f"  {'app/server/favicon.ico':<44} 16/32/48/64")
    print("[icons] done")


if __name__ == "__main__":
    main()

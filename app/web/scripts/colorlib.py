# Vendored de forseti-brand/research/R4-assets/scripts/colorlib.py (spec 0006).
"""Color math used by contrast.py: sRGB <-> OKLab/OKLCH, WCAG 2.x contrast, CVD simulation.

No third-party dependencies, so the measurement is reproducible anywhere with Python 3.
"""
import math


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "#" + "".join(f"{round(max(0, min(1, c)) * 255):02X}" for c in rgb)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def relative_luminance(hexcolor):
    # WCAG 2.2 uses 0.03928 in the text but the result is identical to 0.04045 for 8-bit values.
    r, g, b = (srgb_to_linear(c) for c in hex_to_rgb(hexcolor))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg):
    l1, l2 = relative_luminance(fg), relative_luminance(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def linear_rgb_to_oklab(r, g, b):
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def oklab_to_linear_rgb(L, a, b):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )


def hex_to_oklab(h):
    return linear_rgb_to_oklab(*(srgb_to_linear(c) for c in hex_to_rgb(h)))


def hex_to_oklch(h):
    L, a, b = hex_to_oklab(h)
    C = math.hypot(a, b)
    H = math.degrees(math.atan2(b, a)) % 360
    return L, C, H


def oklch_to_hex(L, C, H):
    """Convert OKLCH to sRGB hex, reducing chroma until the color fits the sRGB gamut."""
    c = C
    while True:
        a, b = c * math.cos(math.radians(H)), c * math.sin(math.radians(H))
        lin = oklab_to_linear_rgb(L, a, b)
        if all(-1e-4 <= v <= 1 + 1e-4 for v in lin) or c <= 0:
            return rgb_to_hex(tuple(linear_to_srgb(max(0, min(1, v))) for v in lin))
        c -= 0.002


def parse_color(value):
    """Accepts '#RRGGBB' or 'oklch(L C H)' with L in 0..1."""
    v = value.strip()
    if v.startswith("#"):
        return v.upper()
    if v.startswith("oklch("):
        L, C, H = (float(x) for x in v[6:-1].split())
        return oklch_to_hex(L, C, H)
    raise ValueError(f"cor não reconhecida: {value}")


def hue_distance(h1, h2):
    d = abs(h1 - h2) % 360
    return min(d, 360 - d)


# Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB.
CVD = {
    "protanopia": ((0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216), (-0.003882, -0.048116, 1.051998)),
    "deuteranopia": ((0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413), (-0.011820, 0.042940, 0.968881)),
    "tritanopia": ((1.255528, -0.076749, -0.178779), (-0.078411, 0.930809, 0.147602), (0.004733, 0.691367, 0.303900)),
}


def simulate(hexcolor, kind):
    lin = [srgb_to_linear(c) for c in hex_to_rgb(hexcolor)]
    m = CVD[kind]
    out = [sum(m[i][j] * lin[j] for j in range(3)) for i in range(3)]
    return rgb_to_hex(tuple(linear_to_srgb(max(0, min(1, v))) for v in out))


def delta_e_ok(h1, h2):
    a, b = hex_to_oklab(h1), hex_to_oklab(h2)
    return math.dist(a, b)

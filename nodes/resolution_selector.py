# Base resolutions (1k) — multiply by 2 to get the listed 2k values
RESOLUTIONS = {
    "9:16 — (ex. 1440×2560)": (720, 1280),
    "16:9 — (ex. 2560×1440)": (1280, 720),
    "3:4 — (ex. 1920×2560)": (960, 1280),
    "4:3 — (ex. 2560×1920)": (1280, 960),
    "1:1 — (ex. 1440×1440)": (720, 720),
    "4:5 — (ex. 1440×1800)": (720, 900),
    "5:4 — (ex. 1800×1440)": (900, 720),
    "21:9 — (ex. 2560×1080)": (1280, 540),
    "9:21 — (ex. 1080×2560)": (540, 1280),
    "16:10 — (ex. 2560×1600)": (1280, 800),
    "10:16 — (ex. 1600×2560)": (800, 1280),
    "3:2 — (ex. 2160×1440)": (1080, 720),
    "2:3 — (ex. 1440×2160)": (720, 1080),
    "2:1 — (ex. 2880×1440)": (1440, 720),
    "1:2 — (ex. 1440×2880)": (720, 1440),
    "5:3 — (ex. 2400×1440)": (1200, 720),
    "3:5 — (ex. 1440×2400)": (720, 1200),
    "3:1 — (ex. 1440×480)": (720, 240),
    "1:3 — (ex. 480×1440)": (240, 720),
}

RESOLUTION_MULTIPLIERS = {
    "1k": 1.0,
    "1.5k": 1.5,
    "2k": 2.0,
    "4k": 4.0,
}


def _round_to_multiple(value, multiple=8):
    return max(multiple, round(value / multiple) * multiple)


class TSResolutionSelector:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "resolution": (list(RESOLUTION_MULTIPLIERS.keys()), {"default": "2k"}),
                "aspect_ratio": (list(RESOLUTIONS.keys()),),
                "scale_factor": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 10.0, "step": 0.1, "round": 0.1}),
                "auto_select": ("BOOLEAN", {"default": False}),
                "latent_compatible": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "input_width": ("INT", {"forceInput": True}),
                "input_height": ("INT", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "get_resolution"
    CATEGORY = "TS_Nodes/Utils"

    def get_resolution(self, resolution, aspect_ratio, scale_factor, auto_select, latent_compatible, input_width=None, input_height=None):
        if auto_select:
            if input_width is None or input_height is None:
                raise ValueError("Auto Select включён — подключите оба входа: input_width и input_height.")

            if scale_factor > 0:
                multiplier = scale_factor
            else:
                multiplier = RESOLUTION_MULTIPLIERS[resolution]

            # Целевая длинная сторона: 1280 — базовый «1k» размер
            target_long = 1280 * multiplier
            # Масштабируем входное изображение, сохраняя точные оригинальные пропорции
            input_long = max(input_width, input_height)
            s = target_long / input_long

            out_w = input_width * s
            out_h = input_height * s
        else:
            base_w, base_h = RESOLUTIONS[aspect_ratio]

            if scale_factor > 0:
                multiplier = scale_factor
            else:
                multiplier = RESOLUTION_MULTIPLIERS[resolution]

            out_w = base_w * multiplier
            out_h = base_h * multiplier

        if latent_compatible:
            out_w = _round_to_multiple(out_w, 8)
            out_h = _round_to_multiple(out_h, 8)

        return (int(out_w), int(out_h))

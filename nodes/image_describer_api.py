import base64
import io
import logging

import numpy as np
import torch
import requests

logger = logging.getLogger(__name__)

# Model → provider mapping and API endpoints
MODEL_CONFIG = {
    # Gemini — 2 лучших для vision
    "gemini-2.5-pro": {"provider": "gemini"},
    "gemini-3.1-pro-preview": {"provider": "gemini"},
    # OpenAI — лучшие для vision
    "gpt-4.1": {"provider": "chatgpt"},
    "gpt-5.4": {"provider": "chatgpt"},
    "gpt-5.4-mini": {"provider": "chatgpt"},
    # Grok (xAI) — 2 лучших для vision
    "grok-4.20-0309-non-reasoning": {"provider": "grok"},
    "grok-4-1-fast-non-reasoning": {"provider": "grok"},
}

MODEL_LIST = list(MODEL_CONFIG.keys())

OPENAI_COMPATIBLE_URLS = {
    "chatgpt": "https://api.openai.com/v1/chat/completions",
    "grok": "https://api.x.ai/v1/chat/completions",
}

GEMINI_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class TSImageDescriberAPI:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "model": (MODEL_LIST, {"default": MODEL_LIST[0]}),
                "api_key": ("STRING", {"default": "", "multiline": False}),
                "prompt": (
                    "STRING",
                    {
                        "default": "Describe this image in detail.",
                        "multiline": True,
                    },
                ),
                "temperature": ("FLOAT", {"default": 0.1, "min": 0.0, "max": 2.0, "step": 0.05}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.05}),
                "max_tokens": ("INT", {"default": 16384, "min": 1, "max": 65536}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "describe"
    CATEGORY = "TS_Nodes"
    OUTPUT_NODE = True

    def _image_to_base64(self, image: torch.Tensor) -> str:
        """Convert a ComfyUI IMAGE tensor (B,H,W,C float32 0-1) to a base64-encoded PNG."""
        if image.ndim == 4:
            image = image[0]
        arr = (image.detach().cpu().clamp(0.0, 1.0).numpy() * 255.0).round().astype(np.uint8)

        from PIL import Image as PILImage

        pil_img = PILImage.fromarray(arr)
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    # ------------------------------------------------------------------
    # OpenAI-compatible request (ChatGPT / Grok)
    # ------------------------------------------------------------------
    def _call_openai_compatible(
        self,
        url: str,
        api_key: str,
        model: str,
        prompt: str,
        b64_image: str,
        temperature: float,
        top_p: float,
        max_tokens: int,
    ) -> str:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{b64_image}",
                            },
                        },
                    ],
                }
            ],
            "temperature": temperature,
            "top_p": top_p,
            "max_completion_tokens": max_tokens,
        }

        print(f"[TS Image Describer API] Sending request to {url} model={model}")
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        print(f"[TS Image Describer API] Response status: {resp.status_code}")
        if resp.status_code != 200:
            body = resp.text[:500]
            print(f"[TS Image Describer API] Error body: {body}")
            return f"[ERROR {resp.status_code}] {body}"
        data = resp.json()
        print(f"[TS Image Describer API] Response keys: {list(data.keys())}")
        try:
            text = data["choices"][0]["message"]["content"]
            if not text:
                return f"[EMPTY RESPONSE] Raw: {str(data)[:500]}"
            return text.strip()
        except (KeyError, IndexError) as e:
            return f"[PARSE ERROR] {e} | Raw: {str(data)[:500]}"

    # ------------------------------------------------------------------
    # Gemini request
    # ------------------------------------------------------------------
    def _call_gemini(
        self,
        api_key: str,
        model: str,
        prompt: str,
        b64_image: str,
        temperature: float,
        top_p: float,
        max_tokens: int,
    ) -> str:
        url = GEMINI_URL_TEMPLATE.format(model=model)
        params = {"key": api_key}
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inlineData": {
                                "mimeType": "image/png",
                                "data": b64_image,
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {
                "temperature": temperature,
                "topP": top_p,
                "maxOutputTokens": max_tokens,
            },
        }

        print(f"[TS Image Describer API] Sending request to Gemini model={model}")
        resp = requests.post(url, params=params, json=payload, timeout=120)
        print(f"[TS Image Describer API] Response status: {resp.status_code}")
        if resp.status_code != 200:
            body = resp.text[:500]
            print(f"[TS Image Describer API] Error body: {body}")
            return f"[ERROR {resp.status_code}] {body}"
        data = resp.json()
        print(f"[TS Image Describer API] Response keys: {list(data.keys())}")
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            if not text:
                return f"[EMPTY RESPONSE] Raw: {str(data)[:500]}"
            return text.strip()
        except (KeyError, IndexError) as e:
            return f"[PARSE ERROR] {e} | Raw: {str(data)[:500]}"

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------
    def describe(
        self,
        image: torch.Tensor,
        model: str,
        api_key: str,
        prompt: str,
        temperature: float,
        top_p: float,
        max_tokens: int,
    ):
        if not api_key or not api_key.strip():
            raise ValueError("API key is empty. Please provide a valid API key.")

        cfg = MODEL_CONFIG.get(model)
        if cfg is None:
            raise ValueError(f"Unknown model: {model}")
        provider = cfg["provider"]

        b64_image = self._image_to_base64(image)

        logger.info(
            f"[TS Image Describer API] provider={provider}, model={model}, "
            f"temp={temperature}, top_p={top_p}, max_tokens={max_tokens}"
        )

        try:
            if provider in OPENAI_COMPATIBLE_URLS:
                result = self._call_openai_compatible(
                    url=OPENAI_COMPATIBLE_URLS[provider],
                    api_key=api_key.strip(),
                    model=model,
                    prompt=prompt,
                    b64_image=b64_image,
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                )
            elif provider == "gemini":
                result = self._call_gemini(
                    api_key=api_key.strip(),
                    model=model,
                    prompt=prompt,
                    b64_image=b64_image,
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                )
            else:
                result = f"[ERROR] Unknown provider: {provider}"
        except Exception as e:
            result = f"[EXCEPTION] {type(e).__name__}: {e}"
            print(f"[TS Image Describer API] {result}")

        print(f"[TS Image Describer API] Result length: {len(result)} chars")
        print(f"[TS Image Describer API] Result preview: {result[:200]}")
        return (result,)

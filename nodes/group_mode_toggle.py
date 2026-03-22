class TSGroupModeToggle:
    """Frontend-only node — all logic lives in the JS extension."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}, "optional": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "TS_Nodes"
    OUTPUT_NODE = True

    def noop(self, **kwargs):
        return {}

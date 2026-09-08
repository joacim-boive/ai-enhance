import copy
import unittest

from vram import cap_resolution, patch_seedvr2_prompt, requested_resolution


HUB_PROMPT = {
    "10": {
        "class_type": "SeedVR2VideoUpscaler",
        "inputs": {
            "resolution": 4320,
            "batch_size": 33,
            "offload_device": "cpu",
        },
    },
    "13": {
        "class_type": "SeedVR2LoadVAEModel",
        "inputs": {
            "encode_tiled": True,
            "encode_tile_size": 1024,
            "encode_tile_overlap": 128,
            "decode_tiled": True,
            "decode_tile_size": 768,
            "decode_tile_overlap": 128,
            "offload_device": "cuda:0",
        },
    },
    "14": {
        "class_type": "SeedVR2LoadDiTModel",
        "inputs": {
            "blocks_to_swap": 0,
            "swap_io_components": False,
            "offload_device": "cpu",
        },
    },
}


class VramTests(unittest.TestCase):
    def test_caps_hub_8k_default_to_4k_short_side(self) -> None:
        patched = patch_seedvr2_prompt(copy.deepcopy(HUB_PROMPT))
        self.assertEqual(patched["10"]["inputs"]["resolution"], 2160)
        self.assertEqual(patched["10"]["inputs"]["batch_size"], 1)
        self.assertEqual(patched["13"]["inputs"]["encode_tile_size"], 256)
        self.assertEqual(patched["13"]["inputs"]["offload_device"], "cpu")
        self.assertEqual(patched["14"]["inputs"]["blocks_to_swap"], 36)
        self.assertTrue(patched["14"]["inputs"]["swap_io_components"])

    def test_honors_job_resolution_for_hfr(self) -> None:
        patched = patch_seedvr2_prompt(copy.deepcopy(HUB_PROMPT), {"resolution": 2160})
        self.assertEqual(patched["10"]["inputs"]["resolution"], 2160)

    def test_requested_resolution_ignores_junk(self) -> None:
        self.assertIsNone(requested_resolution({}))
        self.assertIsNone(requested_resolution({"resolution": "1080"}))
        self.assertEqual(requested_resolution({"resolution": 4320}), 2160)

    def test_cap_resolution_uses_job_then_hub_2x(self) -> None:
        self.assertEqual(cap_resolution(2160, 3840, {"resolution": 2160}), 2160)
        self.assertEqual(cap_resolution(2160, 3840, {}), 2160)
        self.assertEqual(cap_resolution(720, 1280, {}), 1440)


if __name__ == "__main__":
    unittest.main()

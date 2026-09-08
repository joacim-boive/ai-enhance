import copy
import unittest

from vram import (
    apply_rife_fps,
    bypass_seedvr2,
    cap_resolution,
    patch_seedvr2_prompt,
    requested_resolution,
    rife_fps_plan,
    rife_output_fps,
    should_skip_upscale,
)


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

INTERP_PROMPT = {
    **copy.deepcopy(HUB_PROMPT),
    "21": {"class_type": "LoadVideo", "inputs": {"file": "clip.mp4"}},
    "22": {"class_type": "GetVideoComponents", "inputs": {"video": ["21", 0]}},
    "25": {
        "class_type": "VHS_VideoCombine",
        "inputs": {"images": ["26", 0], "audio": ["22", 1], "frame_rate": 48},
    },
    "26": {
        "class_type": "RIFE VFI",
        "inputs": {"ckpt_name": "rife49.pth", "multiplier": 2, "frames": ["10", 0]},
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

    def test_fps_only_skips_seedvr2(self) -> None:
        self.assertTrue(should_skip_upscale({"scale_changed": False, "fps_changed": True}))
        self.assertTrue(should_skip_upscale({"skip_upscale": True}))
        self.assertFalse(should_skip_upscale({"scale_changed": True, "fps_changed": True}))
        self.assertFalse(should_skip_upscale({"resolution": 2160}))

        patched = patch_seedvr2_prompt(
            copy.deepcopy(INTERP_PROMPT),
            {"scale_changed": False, "fps_changed": True, "resolution": 2160},
        )
        self.assertNotIn("10", patched)
        self.assertNotIn("13", patched)
        self.assertNotIn("14", patched)
        self.assertEqual(patched["26"]["inputs"]["frames"], ["22", 0])
        self.assertEqual(patched["25"]["inputs"]["images"], ["26", 0])

    def test_bypass_seedvr2_keeps_rife_on_source_frames(self) -> None:
        patched = bypass_seedvr2(copy.deepcopy(INTERP_PROMPT))
        self.assertEqual(patched["26"]["inputs"]["frames"], ["22", 0])
        self.assertNotIn("10", patched)

    def test_rife_plan_hits_60_from_24_via_5x(self) -> None:
        plan = rife_fps_plan(24, 60)
        self.assertEqual(plan.multiplier, 5)
        self.assertEqual(plan.rife_fps, 120)
        self.assertEqual(plan.output_fps, 60)
        self.assertEqual(plan.decimate, 2)
        self.assertTrue(plan.resample)
        multiplier, dense = rife_output_fps(24, 60)
        self.assertEqual(multiplier, 5)
        self.assertEqual(dense, 120)

        plan = rife_fps_plan(30, 60)
        self.assertEqual(plan.multiplier, 2)
        self.assertEqual(plan.rife_fps, 60)
        self.assertEqual(plan.decimate, 1)
        self.assertFalse(plan.resample)

        plan = rife_fps_plan(30, 120)
        self.assertEqual(plan.multiplier, 4)
        self.assertEqual(plan.rife_fps, 120)
        self.assertFalse(plan.resample)

        plan = rife_fps_plan(23.976, 59.94)
        self.assertEqual(plan.multiplier, 5)
        self.assertEqual(plan.decimate, 2)
        self.assertTrue(plan.resample)

    def test_fps_only_sets_rife_multiplier_and_output_rate(self) -> None:
        patched = patch_seedvr2_prompt(
            copy.deepcopy(INTERP_PROMPT),
            {
                "scale_changed": False,
                "fps_changed": True,
                "fps": 60,
                "source_fps": 30,
            },
        )
        self.assertEqual(patched["26"]["inputs"]["multiplier"], 2)
        self.assertFalse(patched["26"]["inputs"]["ensemble"])
        self.assertEqual(patched["25"]["inputs"]["frame_rate"], 60)
        apply_rife_fps(patched, {"fps": 60, "source_fps": 30})

    def test_fps_only_24_to_60_encodes_120_for_ffmpeg_decimate(self) -> None:
        patched = patch_seedvr2_prompt(
            copy.deepcopy(INTERP_PROMPT),
            {
                "scale_changed": False,
                "fps_changed": True,
                "fps": 60,
                "source_fps": 24,
            },
        )
        self.assertEqual(patched["26"]["inputs"]["multiplier"], 5)
        self.assertEqual(patched["25"]["inputs"]["frame_rate"], 120)
        self.assertEqual(patched["25"]["inputs"]["images"], ["26", 0])
        self.assertNotIn("lumen_decimate_25", patched)
        self.assertNotIn("10", patched)

    def test_upscale_and_fps_still_sets_rife_for_24_to_60(self) -> None:
        patched = patch_seedvr2_prompt(
            copy.deepcopy(INTERP_PROMPT),
            {
                "scale_changed": True,
                "fps_changed": True,
                "fps": 60,
                "source_fps": 24,
                "resolution": 2160,
            },
        )
        self.assertIn("10", patched)
        self.assertEqual(patched["26"]["inputs"]["multiplier"], 5)
        self.assertEqual(patched["25"]["inputs"]["frame_rate"], 120)
        self.assertEqual(patched["25"]["inputs"]["images"][0], "26")

if __name__ == "__main__":
    unittest.main()

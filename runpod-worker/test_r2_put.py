import os
import subprocess
import tempfile
import unittest

from r2_put import (
    attach_local_output,
    conform_output_fps,
    conform_output_rotation,
    fps_filter_value,
    job_target_fps,
    normalize_rotation,
    output_needs_fps,
    output_needs_rotation,
    probe_video,
    transpose_filter,
)


class R2PutTests(unittest.TestCase):
    def test_attach_local_output_inlines_small_file(self) -> None:
        handle = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        try:
            handle.write(b"not-a-real-mp4-but-long-enough-to-inline")
            handle.close()
            attached = attach_local_output({"video_path": handle.name})
            self.assertIn("video_base64", attached)
            self.assertTrue(len(attached["video_base64"]) > 32)
            self.assertEqual(attached["video_path"], handle.name)
        finally:
            os.unlink(handle.name)

    def test_probe_video_reads_fps_from_real_clip(self) -> None:
        path = "/tmp/fps-verify/in30.mp4"
        if not os.path.isfile(path):
            self.skipTest("30 fps fixture missing")
        probe = probe_video(path)
        self.assertEqual(probe.get("fps"), 30.0)
        self.assertEqual(probe.get("width"), 320)
        self.assertEqual(probe.get("height"), 240)

    def test_job_target_fps_reads_fps_fields(self) -> None:
        self.assertEqual(job_target_fps({"fps": 60}), 60.0)
        self.assertEqual(job_target_fps({"target_fps": 59.94}), 59.94)
        self.assertIsNone(job_target_fps({}))
        self.assertEqual(fps_filter_value(60), "60")
        self.assertEqual(fps_filter_value(59.94), "60000/1001")

    def test_conform_output_fps_decimates_120_to_60(self) -> None:
        src = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
        out = src
        try:
            subprocess.check_call(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=16x16:r=120:d=1",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    src,
                ],
                timeout=30,
            )
            out = conform_output_fps(src, {"fps": 60})
            self.assertNotEqual(out, src)
            probe = probe_video(out)
            self.assertEqual(probe.get("fps"), 60.0)
            duration = float(probe.get("duration") or 0)
            self.assertGreater(duration, 0.8)
            self.assertLess(duration, 1.3)
            same = conform_output_fps(out, {"fps": 60})
            self.assertEqual(same, out)
        except FileNotFoundError:
            self.skipTest("ffmpeg not available")
        finally:
            for path in {src, out}:
                if os.path.isfile(path):
                    os.unlink(path)

    def test_rotation_helpers_detect_coded_landscape(self) -> None:
        self.assertEqual(normalize_rotation(-90), 270)
        self.assertEqual(transpose_filter(90), "transpose=1")
        self.assertEqual(transpose_filter(270), "transpose=2")
        self.assertIsNone(transpose_filter(0))
        self.assertTrue(output_needs_rotation(3840, 2160, 90))
        self.assertFalse(output_needs_rotation(2160, 3840, 90))
        self.assertFalse(output_needs_rotation(3840, 2160, 0))
        self.assertTrue(output_needs_fps(48, 60))
        self.assertTrue(output_needs_fps(120, 60))
        self.assertFalse(output_needs_fps(60, 60))

    def test_conform_output_rotation_transposes_landscape_master(self) -> None:
        src = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
        out = src
        try:
            subprocess.check_call(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=red:s=32x16:r=24:d=1",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    src,
                ],
                timeout=30,
            )
            same = conform_output_rotation(src, {"rotation": 0})
            self.assertEqual(same, src)
            out = conform_output_rotation(src, {"rotation": 90})
            self.assertNotEqual(out, src)
            probe = probe_video(out)
            self.assertEqual(probe.get("width"), 16)
            self.assertEqual(probe.get("height"), 32)
        except FileNotFoundError:
            self.skipTest("ffmpeg not available")
        finally:
            for path in {src, out}:
                if os.path.isfile(path):
                    os.unlink(path)


    def test_conform_output_120fps_landscape_becomes_60fps_portrait(self) -> None:
        src = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
        out = src
        try:
            subprocess.check_call(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=32x16:r=120:d=1",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    src,
                ],
                timeout=30,
            )
            out = conform_output_fps(src, {"fps": 60, "rotation": 90})
            self.assertNotEqual(out, src)
            probe = probe_video(out)
            self.assertEqual(probe.get("fps"), 60.0)
            self.assertEqual(probe.get("width"), 16)
            self.assertEqual(probe.get("height"), 32)
        except FileNotFoundError:
            self.skipTest("ffmpeg not available")
        finally:
            for path in {src, out}:
                if os.path.isfile(path):
                    os.unlink(path)

    def test_conform_output_interpolates_48_to_60(self) -> None:
        src = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
        out = src
        try:
            subprocess.check_call(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=green:s=16x16:r=48:d=1",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    src,
                ],
                timeout=30,
            )
            out = conform_output_fps(src, {"fps": 60})
            self.assertNotEqual(out, src)
            probe = probe_video(out)
            self.assertEqual(probe.get("fps"), 60.0)
            duration = float(probe.get("duration") or 0)
            self.assertGreater(duration, 0.8)
            self.assertLess(duration, 1.3)
        except FileNotFoundError:
            self.skipTest("ffmpeg not available")
        finally:
            for path in {src, out}:
                if os.path.isfile(path):
                    os.unlink(path)


if __name__ == "__main__":
    unittest.main()

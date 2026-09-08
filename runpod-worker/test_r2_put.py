import os
import shutil
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

    def test_overlap_extract_drop_concat_keeps_source_frame_count(self) -> None:
        from r2_put import (
            PreparedRifeSource,
            concat_video_files,
            count_video_frames,
            drop_leading_frames,
            extract_frame_range,
            stitch_rife_chunk_outputs,
        )

        work = tempfile.mkdtemp(prefix="lumen-rife-test-")
        src = os.path.join(work, "src.mp4")
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
                    "sine=frequency=440:sample_rate=48000",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=red:s=32x32:r=24",
                    "-map",
                    "1:v:0",
                    "-map",
                    "0:a:0",
                    "-frames:v",
                    "31",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-shortest",
                    src,
                ],
                timeout=30,
            )
            self.assertEqual(count_video_frames(src), 31)
            first = os.path.join(work, "a.mp4")
            second = os.path.join(work, "b.mp4")
            extract_frame_range(src, first, 0, 16)
            extract_frame_range(src, second, 15, 31)
            self.assertEqual(count_video_frames(first), 16)
            self.assertEqual(count_video_frames(second), 16)
            trimmed = os.path.join(work, "b-trim.mp4")
            drop_leading_frames(second, trimmed, 1)
            self.assertEqual(count_video_frames(trimmed), 15)
            joined = os.path.join(work, "joined.mp4")
            concat_video_files([first, trimmed], joined)
            self.assertEqual(count_video_frames(joined), 31)

            stitched = stitch_rife_chunk_outputs(
                [first, second],
                PreparedRifeSource(work, src, [first, second], {}),
            )
            self.assertEqual(count_video_frames(stitched), 31)
            self.assertGreater(float(probe_video(stitched).get("duration") or 0), 1.0)
        except FileNotFoundError:
            self.skipTest("ffmpeg not available")
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def test_prepare_rife_source_bakes_rotation_on_tiny_clip(self) -> None:
        from r2_put import count_video_frames, prepare_rife_source

        src = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
        prepared = None
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
                    "color=c=blue:s=32x16:r=24",
                    "-frames:v",
                    "8",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    src,
                ],
                timeout=30,
            )
            prepared = prepare_rife_source(
                {
                    "video_path": src,
                    "fps": 60,
                    "source_fps": 24,
                    "fps_changed": True,
                    "scale_changed": False,
                    "rotation": 90,
                    "width": 32,
                    "height": 16,
                    "duration": 8 / 24,
                }
            )
            self.assertIsNotNone(prepared)
            assert prepared is not None
            self.assertEqual(len(prepared.chunk_paths), 1)
            self.assertEqual(prepared.work_input.get("rotation"), 0)
            probe = probe_video(prepared.source_path)
            self.assertEqual(probe.get("width"), 16)
            self.assertEqual(probe.get("height"), 32)
            self.assertEqual(count_video_frames(prepared.source_path), 8)
        except FileNotFoundError:
            self.skipTest("ffmpeg not available")
        finally:
            if os.path.isfile(src):
                os.unlink(src)
            if prepared is not None:
                shutil.rmtree(prepared.work_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()

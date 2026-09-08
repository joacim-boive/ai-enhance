import os
import tempfile
import unittest

from r2_put import attach_local_output, probe_video


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


if __name__ == "__main__":
    unittest.main()

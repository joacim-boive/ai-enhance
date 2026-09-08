import unittest

from progress import comfy_progress_percent


class ComfyProgressTests(unittest.TestCase):
    def test_maps_sample_counts_into_the_running_band(self):
        self.assertEqual(comfy_progress_percent(0, 30), 28)
        self.assertEqual(comfy_progress_percent(15, 30), 54)
        self.assertEqual(comfy_progress_percent(30, 30), 80)

    def test_zero_max_stays_at_the_start_of_the_running_band(self):
        self.assertEqual(comfy_progress_percent(1, 0), 28)

    def test_hold_progress_does_not_jump_backwards(self):
        from progress import hold_progress

        self.assertEqual(hold_progress(72, 32), 72)
        self.assertEqual(hold_progress(32, 48), 48)


if __name__ == "__main__":
    unittest.main()

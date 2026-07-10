import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import (
    EegEmotionRequest,
    EmotionControlRequest,
    emotion_to_demon_controls,
    infer_mock_emotion,
)


def test_trigger_class_maps_to_eeg_emotion_label() -> None:
    response = infer_mock_emotion(
        EegEmotionRequest(
            channel_ids=["ch01", "ch02"],
            sample_rate_hz=1000,
            samples=[[1.0, 2.0], [3.0, 4.0]],
            trigger_class=2,
            source="test",
        )
    )

    assert response.emotion == "fear"
    assert response.probabilities["fear"] == response.confidence
    assert response.source == "test"


def test_four_class_paradigm_separates_generation_and_future_regulation() -> None:
    config_path = Path(__file__).resolve().parents[1] / "config" / "eeg_emotion_paradigm.json"
    paradigm = json.loads(config_path.read_text(encoding="utf-8"))

    classes = paradigm["classes"]
    sessions = {item["name"]: item for item in paradigm["sessions"]}
    assert paradigm["version"] == "eeg-music-generation-4class-v3"
    assert paradigm["current_study_scope"] == "eeg_conditioned_music_generation_without_feedback"
    assert paradigm["future_study_scope"] == "closed_loop_music_regulation"
    assert paradigm["minimum_videos_per_class"] == 5
    assert paradigm["trials_per_class_per_session"] == 5
    assert paradigm["minimum_accepted_trials_per_class"] >= 3
    assert "DEAP-style" in paradigm["design_principle"]
    assert {item["paradigm_emotion"] for item in classes} == {
        "depression",
        "anxiety",
        "calm",
        "happy",
    }
    assert {item["system_emotion"] for item in classes} == {"sad", "fear", "neutral", "happy"}
    assert {item["trigger_class"] for item in classes} == {1, 2, 3, 4}
    assert all("accept_self_report" in item for item in classes)
    assert all("generation_goal" in item for item in classes)
    assert all("regulation_goal" in item for item in classes)
    assert paradigm["trial_quality_policy"]["uncertain"].startswith("Keep metadata")
    assert sessions["personal_calibration"]["stage"] == "current_paper"
    assert sessions["held_out_generation"]["stage"] == "current_paper"
    assert not sessions["personal_calibration"]["feedback_enabled"]
    assert not sessions["held_out_generation"]["feedback_enabled"]
    assert sessions["regulation_feedback"]["stage"] == "future_closed_loop"
    assert sessions["regulation_feedback"]["feedback_enabled"]
    assert "held-out-session" in paradigm["training_recommendation"]["minimum_generation_gate"]
    assert paradigm["trial_phase_order"][:4] == [
        "baseline_rest",
        "pre_video_hint",
        "video",
        "post_video_rest",
    ]
    assert not paradigm["recording_contract"]["feedback_enabled_for_current_paper"]
    assert "trials.jsonl" in paradigm["recording_contract"]["session_files"]


def test_emotion_control_maps_to_safe_demon_knobs() -> None:
    raw = emotion_to_demon_controls(
        EmotionControlRequest(
            emotion="fear",
            probabilities={"fear": 0.74, "sad": 0.1, "neutral": 0.08, "happy": 0.08},
            valence=-0.02,
            arousal=0.4,
            playback_pos=0.0,
        )
    )

    assert 0.0 <= raw["denoise"] <= 1.0
    assert 1.0 <= raw["shift"] <= 6.0
    assert 1 <= raw["steps_override"] <= 16
    assert 1.0 <= raw["guidance_scale"] <= 15.0
    assert raw["rcfg_mode"] == "off"

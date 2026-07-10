use super::*;

fn study() -> EegStudySessionInput {
    EegStudySessionInput {
        study_stage: "current_paper".to_string(),
        paradigm_session: "held_out_generation".to_string(),
        subject_id: "sub-001".to_string(),
        session_run_id: "sub-001-session-b".to_string(),
        feedback_enabled: false,
    }
}

fn begin() -> BeginEegTrialInput {
    BeginEegTrialInput {
        trial_id: "trial-001".to_string(),
        paradigm_emotion: "anxiety".to_string(),
        system_emotion: "fear".to_string(),
        trigger_class: 2,
        video_id: "anxiety-01".to_string(),
        video_path: "database/Anxiety/anxiety-01.mp4".to_string(),
    }
}

fn outcome(acceptance: &str) -> FinalizeEegTrialInput {
    FinalizeEegTrialInput {
        trial_id: "trial-001".to_string(),
        self_report_valence: 3.0,
        self_report_arousal: 7.0,
        self_report_dominance: Some(4.0),
        self_report_acceptance: acceptance.to_string(),
        label_source: "self_report_confirmed".to_string(),
        artifact_flags: if acceptance == "artifact_rejected" {
            vec!["missing_trigger".to_string()]
        } else {
            Vec::new()
        },
        operator_notes: None,
    }
}

fn advance_to_end(state: &mut EegTrialState, with_triggers: bool) {
    state.begin(begin(), 10, "t0".to_string()).unwrap();
    for (phase, sample, at) in [
        ("pre_video_hint", 20, "t1"),
        ("video", 30, "t2"),
        ("post_video_rest", 81, "t3"),
    ] {
        if phase == "video" && with_triggers {
            state
                .mark_phase(
                    MarkEegTrialPhaseInput {
                        trial_id: "trial-001".to_string(),
                        phase: phase.to_string(),
                    },
                    sample,
                    at.to_string(),
                )
                .unwrap();
            state.observe_trigger(2, 31);
            state.observe_trigger(255, 80);
            continue;
        }
        state
            .mark_phase(
                MarkEegTrialPhaseInput {
                    trial_id: "trial-001".to_string(),
                    phase: phase.to_string(),
                },
                sample,
                at.to_string(),
            )
            .unwrap();
    }
    state
        .end(
            EndEegTrialInput {
                trial_id: "trial-001".to_string(),
            },
            90,
            "t4".to_string(),
        )
        .unwrap();
}

#[test]
fn ignores_trigger_markers_outside_the_video_phase() {
    let mut state = EegTrialState::new(study()).unwrap();
    state.begin(begin(), 10, "t0".to_string()).unwrap();
    state.observe_trigger(2, 11);
    state.observe_trigger(255, 12);
    state
        .mark_phase(
            MarkEegTrialPhaseInput {
                trial_id: "trial-001".to_string(),
                phase: "pre_video_hint".to_string(),
            },
            20,
            "t1".to_string(),
        )
        .unwrap();
    state.observe_trigger(2, 21);
    state.observe_trigger(255, 22);
    state
        .mark_phase(
            MarkEegTrialPhaseInput {
                trial_id: "trial-001".to_string(),
                phase: "video".to_string(),
            },
            30,
            "t2".to_string(),
        )
        .unwrap();
    state
        .mark_phase(
            MarkEegTrialPhaseInput {
                trial_id: "trial-001".to_string(),
                phase: "post_video_rest".to_string(),
            },
            80,
            "t3".to_string(),
        )
        .unwrap();
    let end = state
        .end(
            EndEegTrialInput {
                trial_id: "trial-001".to_string(),
            },
            90,
            "t4".to_string(),
        )
        .unwrap();
    assert_eq!(end.trigger_start_sample, None);
    assert_eq!(end.trigger_end_sample, None);
}

#[test]
fn current_sessions_require_feedback_disabled_and_reject_future_scope() {
    assert_eq!(validate_study_session(&study()), Ok(()));
    let mut invalid = study();
    invalid.feedback_enabled = true;
    assert_eq!(
        validate_study_session(&invalid),
        Err("Feedback must be disabled for current-paper sessions.".to_string())
    );
    invalid.feedback_enabled = false;
    invalid.study_stage = "future_closed_loop".to_string();
    assert_eq!(
        validate_study_session(&invalid),
        Err("Only current_paper study sessions are enabled.".to_string())
    );
}

#[test]
fn freezes_eeg_boundary_before_self_report_and_finalizes_auditable_record() {
    let mut state = EegTrialState::new(study()).unwrap();
    advance_to_end(&mut state, true);
    let record = state.finalize(outcome("accepted")).unwrap();
    assert_eq!(record.eeg_start_sample, 10);
    assert_eq!(record.eeg_end_sample, 90);
    assert_eq!(record.trigger_start_sample, Some(31));
    assert_eq!(record.trigger_end_sample, Some(80));
    assert!(!record.feedback_enabled);
    assert_eq!(state.completed_count(), 1);
}

#[test]
fn requires_artifact_rejection_when_trigger_markers_are_missing() {
    let mut state = EegTrialState::new(study()).unwrap();
    advance_to_end(&mut state, false);
    assert_eq!(
        state.finalize(outcome("accepted")),
        Err("Missing trigger markers require artifact_rejected.".to_string())
    );
    assert_eq!(
        state
            .finalize(outcome("artifact_rejected"))
            .unwrap()
            .self_report_acceptance
            .as_deref(),
        Some("artifact_rejected")
    );
}

#[test]
fn rejects_out_of_order_phase_transitions() {
    let mut state = EegTrialState::new(study()).unwrap();
    state.begin(begin(), 10, "t0".to_string()).unwrap();
    assert_eq!(
        state.mark_phase(
            MarkEegTrialPhaseInput {
                trial_id: "trial-001".to_string(),
                phase: "video".to_string(),
            },
            20,
            "t1".to_string(),
        ),
        Err("Trial phases must advance in the configured order.".to_string())
    );
}

#[test]
fn rejects_duplicate_trial_ids_inside_one_session_run() {
    let mut state = EegTrialState::new(study()).unwrap();
    advance_to_end(&mut state, true);
    state.finalize(outcome("accepted")).unwrap();
    assert_eq!(
        state.begin(begin(), 100, "t5".to_string()),
        Err("Trial id has already been finalized in this session run.".to_string())
    );
}

#[test]
fn interrupted_trial_remains_auditable() {
    let mut state = EegTrialState::new(study()).unwrap();
    state.begin(begin(), 10, "t0".to_string()).unwrap();
    let record = state
        .interrupt(25, "t1".to_string(), "device_disconnected")
        .unwrap();
    assert_eq!(record.completion_status, "interrupted");
    assert_eq!(record.eeg_start_sample, 10);
    assert_eq!(record.eeg_end_sample, 25);
    assert_eq!(record.artifact_flags, vec!["device_disconnected"]);
    assert_eq!(state.interrupted_count(), 1);
}

#[test]
fn wrong_end_id_does_not_discard_the_active_trial() {
    let mut state = EegTrialState::new(study()).unwrap();
    state.begin(begin(), 10, "t0".to_string()).unwrap();
    assert_eq!(
        state.end(
            EndEegTrialInput {
                trial_id: "wrong-trial".to_string(),
            },
            20,
            "t1".to_string(),
        ),
        Err("Trial id does not match the active trial.".to_string())
    );
    assert!(state
        .interrupt(25, "t2".to_string(), "test_cleanup")
        .is_some());
}

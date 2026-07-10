use super::*;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

fn setup_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory sqlite");
    conn.execute(
        "CREATE TABLE users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )
    .expect("create users table");
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at, updated_at)
            VALUES ('user-1', 'alice', 'hash', 'now', 'now')",
        [],
    )
    .expect("insert user");
    init_eeg_session_schema(&conn).expect("init eeg schema");
    conn
}

fn temp_recording_dir() -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("tauri-eeg-storage-test-{suffix}"))
}

#[test]
fn creates_eeg_sessions_schema() {
    let conn = setup_conn();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'eeg_sessions'",
            [],
            |row| row.get(0),
        )
        .expect("query schema");

    assert_eq!(count, 1);
}

#[test]
fn rejects_recording_for_missing_user() {
    let conn = setup_conn();
    let base_dir = temp_recording_dir();

    let result = RecordingWriter::start(
        &conn,
        &base_dir,
        StartEegRecordingInput {
            user_id: "missing".to_string(),
            username: "alice".to_string(),
            study_session: None,
        },
        &EegStreamConfig::default(),
    );

    assert_eq!(result.unwrap_err(), "User not found.");
}

#[test]
fn generic_recording_without_study_context_remains_supported() {
    let conn = setup_conn();
    let base_dir = temp_recording_dir();
    let mut writer = RecordingWriter::start(
        &conn,
        &base_dir,
        StartEegRecordingInput {
            user_id: "user-1".to_string(),
            username: "alice".to_string(),
            study_session: None,
        },
        &EegStreamConfig::default(),
    )
    .expect("start generic writer");
    writer
        .write_sample(&[0.0_f32; EEG_CHANNEL_COUNT], 0)
        .expect("write generic sample");
    let session = writer.finish(&conn).expect("finish generic writer");
    let metadata: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(Path::new(&session.session_dir).join(METADATA_FILE_NAME))
            .expect("read generic metadata"),
    )
    .expect("parse generic metadata");
    assert!(metadata["studySession"].is_null());
    assert!(metadata["trialEventsFile"].is_null());
    assert!(!Path::new(&session.session_dir)
        .join(TRIALS_FILE_NAME)
        .exists());
    let _ = fs::remove_dir_all(base_dir);
}

#[test]
fn writes_continuous_session_with_frozen_trial_boundaries() {
    let conn = setup_conn();
    let base_dir = temp_recording_dir();
    let mut writer = RecordingWriter::start(
        &conn,
        &base_dir,
        StartEegRecordingInput {
            user_id: "user-1".to_string(),
            username: "alice".to_string(),
            study_session: Some(EegStudySessionInput {
                study_stage: "current_paper".to_string(),
                paradigm_session: "held_out_generation".to_string(),
                subject_id: "sub-001".to_string(),
                session_run_id: "sub-001-session-b".to_string(),
                feedback_enabled: false,
            }),
        },
        &EegStreamConfig::default(),
    )
    .expect("start writer");

    writer
        .begin_trial(BeginEegTrialInput {
            trial_id: "trial-001".to_string(),
            paradigm_emotion: "anxiety".to_string(),
            system_emotion: "fear".to_string(),
            trigger_class: 2,
            video_id: "anxiety-01".to_string(),
            video_path: "database/Anxiety/anxiety-01.mp4".to_string(),
        })
        .expect("begin trial");
    let mut sample = [0.0_f32; EEG_CHANNEL_COUNT];
    sample[0] = 1.25;
    sample[31] = -2.5;
    writer.write_sample(&sample, 0).expect("write baseline");
    writer
        .mark_trial_phase(MarkEegTrialPhaseInput {
            trial_id: "trial-001".to_string(),
            phase: "pre_video_hint".to_string(),
        })
        .expect("mark hint");
    writer.write_sample(&sample, 0).expect("write hint");
    writer
        .mark_trial_phase(MarkEegTrialPhaseInput {
            trial_id: "trial-001".to_string(),
            phase: "video".to_string(),
        })
        .expect("mark video");
    writer
        .write_sample(&sample, 2)
        .expect("write trigger start");
    writer
        .write_sample(&sample, 255)
        .expect("write trigger end");
    writer
        .mark_trial_phase(MarkEegTrialPhaseInput {
            trial_id: "trial-001".to_string(),
            phase: "post_video_rest".to_string(),
        })
        .expect("mark rest");
    writer.write_sample(&sample, 0).expect("write rest");
    writer
        .end_trial(EndEegTrialInput {
            trial_id: "trial-001".to_string(),
        })
        .expect("freeze trial EEG");
    writer
        .write_sample(&sample, 0)
        .expect("write self-report period");
    writer
        .finalize_trial(FinalizeEegTrialInput {
            trial_id: "trial-001".to_string(),
            self_report_valence: 3.0,
            self_report_arousal: 7.0,
            self_report_dominance: Some(4.0),
            self_report_acceptance: "accepted".to_string(),
            label_source: "self_report_confirmed".to_string(),
            artifact_flags: Vec::new(),
            operator_notes: Some("clean trial".to_string()),
        })
        .expect("finalize trial");
    let session = writer.finish(&conn).expect("finish writer");

    let eeg_bytes =
        fs::read(Path::new(&session.session_dir).join(EEG_FILE_NAME)).expect("read eeg binary");
    let trigger_bytes = fs::read(Path::new(&session.session_dir).join(TRIGGER_FILE_NAME))
        .expect("read trigger binary");
    let metadata_text =
        fs::read_to_string(Path::new(&session.session_dir).join(METADATA_FILE_NAME))
            .expect("read metadata");
    let metadata: serde_json::Value = serde_json::from_str(&metadata_text).expect("parse metadata");
    let trials_text = fs::read_to_string(Path::new(&session.session_dir).join(TRIALS_FILE_NAME))
        .expect("read trials");
    let trial: serde_json::Value =
        serde_json::from_str(trials_text.trim()).expect("parse trial record");
    let sessions = list_eeg_sessions(&conn, "user-1").expect("list sessions");

    assert_eq!(
        eeg_bytes.len(),
        6 * EEG_CHANNEL_COUNT * std::mem::size_of::<f32>()
    );
    assert_eq!(&eeg_bytes[0..4], &1.25_f32.to_le_bytes());
    assert_eq!(&eeg_bytes[(31 * 4)..(32 * 4)], &(-2.5_f32).to_le_bytes());
    assert_eq!(trigger_bytes.len(), 6 * std::mem::size_of::<i32>());
    assert_eq!(metadata["formatVersion"], 3);
    assert_eq!(metadata["userId"], "user-1");
    assert_eq!(metadata["channelCount"], 32);
    assert_eq!(metadata["eegDtype"], "float32_le");
    assert_eq!(metadata["eegLayout"], "sample_major");
    assert_eq!(metadata["sampleCount"], 6);
    assert_eq!(metadata["studySession"]["studyStage"], "current_paper");
    assert_eq!(metadata["studySession"]["subjectId"], "sub-001");
    assert_eq!(metadata["completedTrialCount"], 1);
    assert_eq!(metadata["deviceMetadata"]["blockIntervalMs"], 50);
    assert_eq!(trial["eegStartSample"], 0);
    assert_eq!(trial["eegEndSample"], 5);
    assert_eq!(trial["triggerStartSample"], 2);
    assert_eq!(trial["triggerEndSample"], 3);
    assert_eq!(trial["selfReportAcceptance"], "accepted");
    assert_eq!(trial["completionStatus"], "completed");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].user_id, "user-1");
    assert_eq!(sessions[0].sample_count, 6);
    assert!(Path::new(&session.session_dir)
        .ends_with(Path::new("alice").join("eeg_recordings").join(&session.id)));

    let _ = fs::remove_dir_all(base_dir);
}

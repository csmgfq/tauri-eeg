use tauri::State;

use crate::db::AppDb;

use super::{
    BeginEegTrialInput, EegRecordingSession, EegStatus, EegStreamConfig, EegStreamInfo,
    EegStreamState, EegTrialEvent, EegTrialRecord, EndEegTrialInput, FinalizeEegTrialInput,
    MarkEegTrialPhaseInput, StartEegRecordingInput,
};

#[tauri::command]
pub(crate) fn start_eeg_stream(
    app: tauri::AppHandle,
    state: State<'_, EegStreamState>,
    config: Option<EegStreamConfig>,
) -> Result<EegStreamInfo, String> {
    super::start_stream(app, &state, config)
}

#[tauri::command]
pub(crate) fn stop_eeg_stream(
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
) -> Result<(), String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    super::stop_stream(&state, &conn)
}

#[tauri::command]
pub(crate) fn get_eeg_status(state: State<'_, EegStreamState>) -> Result<EegStatus, String> {
    super::get_status(&state)
}

#[tauri::command]
pub(crate) fn start_eeg_recording(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
    input: StartEegRecordingInput,
) -> Result<EegRecordingSession, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    super::start_recording(&app, &conn, &state, input)
}

#[tauri::command]
pub(crate) fn stop_eeg_recording(
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
) -> Result<EegRecordingSession, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    super::stop_recording(&conn, &state)
}

#[tauri::command]
pub(crate) fn list_eeg_sessions(
    db: State<'_, AppDb>,
    user_id: String,
) -> Result<Vec<EegRecordingSession>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    super::list_sessions(&conn, &user_id)
}

#[tauri::command]
pub(crate) fn begin_eeg_trial(
    state: State<'_, EegStreamState>,
    input: BeginEegTrialInput,
) -> Result<EegTrialEvent, String> {
    super::begin_trial(&state, input)
}

#[tauri::command]
pub(crate) fn mark_eeg_trial_phase(
    state: State<'_, EegStreamState>,
    input: MarkEegTrialPhaseInput,
) -> Result<EegTrialEvent, String> {
    super::mark_trial_phase(&state, input)
}

#[tauri::command]
pub(crate) fn end_eeg_trial(
    state: State<'_, EegStreamState>,
    input: EndEegTrialInput,
) -> Result<EegTrialEvent, String> {
    super::end_trial(&state, input)
}

#[tauri::command]
pub(crate) fn finalize_eeg_trial(
    state: State<'_, EegStreamState>,
    input: FinalizeEegTrialInput,
) -> Result<EegTrialRecord, String> {
    super::finalize_trial(&state, input)
}

#[tauri::command]
pub(crate) fn load_eeg_study_video_library(
    folder_path: String,
) -> Result<super::EegStudyVideoLibrary, String> {
    super::load_eeg_study_video_library(&folder_path)
}

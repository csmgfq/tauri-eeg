use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Error as SqlError};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

use super::{
    buffer::default_channel_ids,
    protocol::EEG_CHANNEL_COUNT,
    session::{EegRecordingDeviceMetadata, EegRecordingSession, StartEegRecordingInput},
    trial::{
        BeginEegTrialInput, EegStudySessionInput, EegTrialEvent, EegTrialRecord, EegTrialState,
        EndEegTrialInput, FinalizeEegTrialInput, MarkEegTrialPhaseInput,
    },
    EegStreamConfig,
};

const EEG_FILE_NAME: &str = "eeg.f32le.bin";
const TRIGGER_FILE_NAME: &str = "trigger.i32le.bin";
const METADATA_FILE_NAME: &str = "metadata.json";
const TRIAL_EVENTS_FILE_NAME: &str = "trial-events.jsonl";
const TRIALS_FILE_NAME: &str = "trials.jsonl";
const DISPLAY_CHANNEL_LIMIT: usize = 16;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingMetadata {
    format_version: u8,
    session_id: String,
    user_id: String,
    username: String,
    sample_rate_hz: u32,
    channel_count: usize,
    channel_ids: Vec<String>,
    display_channel_limit: usize,
    eeg_file: String,
    eeg_dtype: String,
    eeg_layout: String,
    trigger_file: String,
    trigger_dtype: String,
    sample_count: u64,
    started_at: String,
    ended_at: String,
    duration_seconds: f64,
    device_metadata: EegRecordingDeviceMetadata,
    study_session: Option<EegStudySessionInput>,
    trial_events_file: Option<String>,
    trials_file: Option<String>,
    completed_trial_count: u32,
    interrupted_trial_count: u32,
}

#[derive(Debug)]
pub struct RecordingWriter {
    session: EegRecordingSession,
    eeg_writer: BufWriter<File>,
    trigger_writer: BufWriter<File>,
    started_at: DateTime<Utc>,
    device_metadata: EegRecordingDeviceMetadata,
    trial_state: Option<EegTrialState>,
    trial_events_writer: Option<BufWriter<File>>,
    trials_writer: Option<BufWriter<File>>,
}

impl RecordingWriter {
    pub fn start(
        conn: &Connection,
        base_dir: &Path,
        input: StartEegRecordingInput,
        config: &EegStreamConfig,
    ) -> Result<Self, String> {
        let trial_state = input
            .study_session
            .clone()
            .map(EegTrialState::new)
            .transpose()?;
        let user_id = validate_user(conn, &input)?;
        let started_at = Utc::now();
        let session_id = started_at.format("session_%Y%m%d_%H%M%S").to_string();
        let roots = crate::storage_paths::user_storage_roots(base_dir, &user_id.username)?;
        let session_dir = unique_session_dir(&roots.eeg_recordings_dir, &session_id)?;
        fs::create_dir_all(&session_dir)
            .map_err(|_| "Failed to create EEG session directory.".to_string())?;

        let eeg_path = session_dir.join(EEG_FILE_NAME);
        let trigger_path = session_dir.join(TRIGGER_FILE_NAME);
        let eeg_writer = BufWriter::new(
            File::create(&eeg_path).map_err(|_| "Failed to create EEG binary file.".to_string())?,
        );
        let trigger_writer = BufWriter::new(
            File::create(&trigger_path)
                .map_err(|_| "Failed to create trigger binary file.".to_string())?,
        );
        let (trial_events_writer, trials_writer) = if trial_state.is_some() {
            let events = File::create(session_dir.join(TRIAL_EVENTS_FILE_NAME))
                .map_err(|_| "Failed to create EEG trial events file.".to_string())?;
            let trials = File::create(session_dir.join(TRIALS_FILE_NAME))
                .map_err(|_| "Failed to create EEG trials file.".to_string())?;
            (Some(BufWriter::new(events)), Some(BufWriter::new(trials)))
        } else {
            (None, None)
        };

        let session = EegRecordingSession {
            id: session_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&session_id)
                .to_string(),
            user_id: user_id.user_id,
            username: user_id.username,
            session_dir: session_dir.to_string_lossy().to_string(),
            eeg_file: EEG_FILE_NAME.to_string(),
            trigger_file: TRIGGER_FILE_NAME.to_string(),
            metadata_file: METADATA_FILE_NAME.to_string(),
            sample_rate_hz: config.sample_rate_hz,
            channel_count: EEG_CHANNEL_COUNT,
            sample_count: 0,
            duration_seconds: None,
            started_at: started_at.to_rfc3339(),
            ended_at: None,
        };

        Ok(Self {
            session,
            eeg_writer,
            trigger_writer,
            started_at,
            device_metadata: EegRecordingDeviceMetadata {
                bind_host: config.bind_host.clone(),
                tcp_port: config.tcp_port,
                eeg_device_ip: config.eeg_device_ip.clone(),
                trigger_device_ip: config.trigger_device_ip.clone(),
                block_interval_ms: config.block_interval_ms,
            },
            trial_state,
            trial_events_writer,
            trials_writer,
        })
    }

    pub fn session(&self) -> EegRecordingSession {
        self.session.clone()
    }

    pub fn write_sample(
        &mut self,
        samples_uv: &[f32; EEG_CHANNEL_COUNT],
        trigger: i32,
    ) -> Result<(), String> {
        if let Some(state) = self.trial_state.as_mut() {
            state.observe_trigger(trigger, self.session.sample_count);
        }
        for sample in samples_uv {
            self.eeg_writer
                .write_all(&sample.to_le_bytes())
                .map_err(|_| "Failed to write EEG sample.".to_string())?;
        }
        self.trigger_writer
            .write_all(&trigger.to_le_bytes())
            .map_err(|_| "Failed to write trigger sample.".to_string())?;
        self.session.sample_count += 1;
        Ok(())
    }

    pub fn begin_trial(&mut self, input: BeginEegTrialInput) -> Result<EegTrialEvent, String> {
        let sample_index = self.session.sample_count;
        let recorded_at = Utc::now().to_rfc3339();
        let event = self
            .trial_state_mut()?
            .begin(input, sample_index, recorded_at)?;
        write_json_line(self.trial_events_writer_mut()?, &event)?;
        Ok(event)
    }

    pub fn mark_trial_phase(
        &mut self,
        input: MarkEegTrialPhaseInput,
    ) -> Result<EegTrialEvent, String> {
        let sample_index = self.session.sample_count;
        let recorded_at = Utc::now().to_rfc3339();
        let event = self
            .trial_state_mut()?
            .mark_phase(input, sample_index, recorded_at)?;
        write_json_line(self.trial_events_writer_mut()?, &event)?;
        Ok(event)
    }

    pub fn end_trial(&mut self, input: EndEegTrialInput) -> Result<EegTrialEvent, String> {
        let sample_index = self.session.sample_count;
        let recorded_at = Utc::now().to_rfc3339();
        let event = self
            .trial_state_mut()?
            .end(input, sample_index, recorded_at)?;
        write_json_line(self.trial_events_writer_mut()?, &event)?;
        Ok(event)
    }

    pub fn finalize_trial(
        &mut self,
        input: FinalizeEegTrialInput,
    ) -> Result<EegTrialRecord, String> {
        let record = self.trial_state_mut()?.finalize(input)?;
        write_json_line(self.trials_writer_mut()?, &record)?;
        Ok(record)
    }

    pub fn finish(mut self, conn: &Connection) -> Result<EegRecordingSession, String> {
        let ended_at = Utc::now();
        let interrupted = self.trial_state.as_mut().and_then(|state| {
            state.interrupt(
                self.session.sample_count,
                ended_at.to_rfc3339(),
                "recording_stopped_before_trial_finalize",
            )
        });
        if let Some(record) = interrupted {
            write_json_line(self.trials_writer_mut()?, &record)?;
        }
        self.eeg_writer
            .flush()
            .map_err(|_| "Failed to flush EEG binary file.".to_string())?;
        self.trigger_writer
            .flush()
            .map_err(|_| "Failed to flush trigger binary file.".to_string())?;
        if let Some(writer) = self.trial_events_writer.as_mut() {
            writer
                .flush()
                .map_err(|_| "Failed to flush EEG trial events file.".to_string())?;
        }
        if let Some(writer) = self.trials_writer.as_mut() {
            writer
                .flush()
                .map_err(|_| "Failed to flush EEG trials file.".to_string())?;
        }
        let duration_seconds = (ended_at - self.started_at)
            .to_std()
            .map(|duration| duration.as_secs_f64())
            .unwrap_or_default();
        self.session.ended_at = Some(ended_at.to_rfc3339());
        self.session.duration_seconds = Some(duration_seconds);

        let (study_session, completed_count, interrupted_count) = self
            .trial_state
            .as_ref()
            .map(|state| {
                (
                    Some(state.study().clone()),
                    state.completed_count(),
                    state.interrupted_count(),
                )
            })
            .unwrap_or((None, 0, 0));
        write_metadata(
            &self.session,
            duration_seconds,
            self.device_metadata,
            study_session,
            completed_count,
            interrupted_count,
        )?;
        insert_eeg_session(conn, &self.session)?;
        Ok(self.session)
    }

    fn trial_state_mut(&mut self) -> Result<&mut EegTrialState, String> {
        self.trial_state
            .as_mut()
            .ok_or_else(|| "The active EEG recording has no study session context.".to_string())
    }

    fn trial_events_writer_mut(&mut self) -> Result<&mut BufWriter<File>, String> {
        self.trial_events_writer
            .as_mut()
            .ok_or_else(|| "EEG trial events writer is unavailable.".to_string())
    }

    fn trials_writer_mut(&mut self) -> Result<&mut BufWriter<File>, String> {
        self.trials_writer
            .as_mut()
            .ok_or_else(|| "EEG trials writer is unavailable.".to_string())
    }
}

fn write_json_line<T: Serialize>(writer: &mut BufWriter<File>, value: &T) -> Result<(), String> {
    serde_json::to_writer(&mut *writer, value)
        .map_err(|_| "Failed to serialize EEG trial data.".to_string())?;
    writer
        .write_all(b"\n")
        .map_err(|_| "Failed to write EEG trial data.".to_string())?;
    writer
        .flush()
        .map_err(|_| "Failed to flush EEG trial data.".to_string())
}

#[derive(Debug)]
struct ValidUser {
    user_id: String,
    username: String,
}

pub fn init_eeg_session_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS eeg_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            session_dir TEXT NOT NULL,
            eeg_file TEXT NOT NULL,
            trigger_file TEXT NOT NULL,
            metadata_file TEXT NOT NULL,
            sample_rate_hz INTEGER NOT NULL,
            channel_count INTEGER NOT NULL,
            sample_count INTEGER NOT NULL,
            duration_seconds REAL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_eeg_sessions_user_started
            ON eeg_sessions(user_id, started_at DESC);",
    )
    .map_err(|_| "Failed to initialize EEG session schema.".to_string())
}

pub fn list_eeg_sessions(
    conn: &Connection,
    user_id: &str,
) -> Result<Vec<EegRecordingSession>, String> {
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Err("User id is required.".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, username, session_dir, eeg_file, trigger_file, metadata_file,
                sample_rate_hz, channel_count, sample_count, duration_seconds, started_at, ended_at
             FROM eeg_sessions
             WHERE user_id = ?1
             ORDER BY started_at DESC",
        )
        .map_err(|_| "Failed to load EEG sessions.".to_string())?;

    let rows = stmt
        .query_map(params![user_id], |row| {
            Ok(EegRecordingSession {
                id: row.get(0)?,
                user_id: row.get(1)?,
                username: row.get(2)?,
                session_dir: row.get(3)?,
                eeg_file: row.get(4)?,
                trigger_file: row.get(5)?,
                metadata_file: row.get(6)?,
                sample_rate_hz: row.get::<_, i64>(7)? as u32,
                channel_count: row.get::<_, i64>(8)? as usize,
                sample_count: row.get::<_, i64>(9)? as u64,
                duration_seconds: row.get(10)?,
                started_at: row.get(11)?,
                ended_at: row.get(12)?,
            })
        })
        .map_err(|_| "Failed to load EEG sessions.".to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to load EEG sessions.".to_string())
}

fn validate_user(conn: &Connection, input: &StartEegRecordingInput) -> Result<ValidUser, String> {
    let user_id = input.user_id.trim();
    let username = input.username.trim();
    if user_id.is_empty() {
        return Err("User id is required.".to_string());
    }
    if username.is_empty() {
        return Err("Username is required.".to_string());
    }

    let result = conn.query_row(
        "SELECT username FROM users WHERE id = ?1",
        params![user_id],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(stored_username) if stored_username == username => Ok(ValidUser {
            user_id: user_id.to_string(),
            username: username.to_string(),
        }),
        Ok(_) => Err("User identity does not match the logged-in account.".to_string()),
        Err(SqlError::QueryReturnedNoRows) => Err("User not found.".to_string()),
        Err(_) => Err("Failed to validate user.".to_string()),
    }
}

fn unique_session_dir(user_base_dir: &Path, session_id: &str) -> Result<PathBuf, String> {
    for suffix in 0..100 {
        let name = if suffix == 0 {
            session_id.to_string()
        } else {
            format!("{session_id}_{suffix:02}")
        };
        let candidate = user_base_dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Failed to allocate EEG session directory.".to_string())
}

fn write_metadata(
    session: &EegRecordingSession,
    duration_seconds: f64,
    device_metadata: EegRecordingDeviceMetadata,
    study_session: Option<EegStudySessionInput>,
    completed_trial_count: u32,
    interrupted_trial_count: u32,
) -> Result<(), String> {
    let ended_at = session
        .ended_at
        .clone()
        .ok_or_else(|| "EEG session end time is unavailable.".to_string())?;
    let metadata = RecordingMetadata {
        format_version: 3,
        session_id: session.id.clone(),
        user_id: session.user_id.clone(),
        username: session.username.clone(),
        sample_rate_hz: session.sample_rate_hz,
        channel_count: session.channel_count,
        channel_ids: default_channel_ids(),
        display_channel_limit: DISPLAY_CHANNEL_LIMIT,
        eeg_file: EEG_FILE_NAME.to_string(),
        eeg_dtype: "float32_le".to_string(),
        eeg_layout: "sample_major".to_string(),
        trigger_file: TRIGGER_FILE_NAME.to_string(),
        trigger_dtype: "int32_le".to_string(),
        sample_count: session.sample_count,
        started_at: session.started_at.clone(),
        ended_at,
        duration_seconds,
        device_metadata,
        trial_events_file: study_session
            .as_ref()
            .map(|_| TRIAL_EVENTS_FILE_NAME.to_string()),
        trials_file: study_session.as_ref().map(|_| TRIALS_FILE_NAME.to_string()),
        study_session,
        completed_trial_count,
        interrupted_trial_count,
    };

    let metadata_path = Path::new(&session.session_dir).join(METADATA_FILE_NAME);
    let json = serde_json::to_string_pretty(&metadata)
        .map_err(|_| "Failed to serialize EEG metadata.".to_string())?;
    fs::write(metadata_path, json).map_err(|_| "Failed to write EEG metadata.".to_string())
}

fn insert_eeg_session(conn: &Connection, session: &EegRecordingSession) -> Result<(), String> {
    conn.execute(
        "INSERT INTO eeg_sessions
            (id, user_id, username, session_dir, eeg_file, trigger_file, metadata_file,
             sample_rate_hz, channel_count, sample_count, duration_seconds, started_at, ended_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            session.id,
            session.user_id,
            session.username,
            session.session_dir,
            session.eeg_file,
            session.trigger_file,
            session.metadata_file,
            session.sample_rate_hz,
            session.channel_count as i64,
            session.sample_count as i64,
            session.duration_seconds,
            session.started_at,
            session.ended_at,
            Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|_| "Failed to save EEG session.".to_string())?;

    Ok(())
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;

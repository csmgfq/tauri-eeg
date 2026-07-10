use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const CURRENT_PAPER_STAGE: &str = "current_paper";
const PHASES: [&str; 4] = [
    "baseline_rest",
    "pre_video_hint",
    "video",
    "post_video_rest",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStudySessionInput {
    pub study_stage: String,
    pub paradigm_session: String,
    pub subject_id: String,
    pub session_run_id: String,
    pub feedback_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginEegTrialInput {
    pub trial_id: String,
    pub paradigm_emotion: String,
    pub system_emotion: String,
    pub trigger_class: u8,
    pub video_id: String,
    pub video_path: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkEegTrialPhaseInput {
    pub trial_id: String,
    pub phase: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndEegTrialInput {
    pub trial_id: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeEegTrialInput {
    pub trial_id: String,
    pub self_report_valence: f32,
    pub self_report_arousal: f32,
    pub self_report_dominance: Option<f32>,
    pub self_report_acceptance: String,
    pub label_source: String,
    #[serde(default)]
    pub artifact_flags: Vec<String>,
    pub operator_notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegTrialEvent {
    pub event_type: String,
    pub trial_id: String,
    pub phase: String,
    pub sample_index: u64,
    pub recorded_at: String,
    pub trigger_start_sample: Option<u64>,
    pub trigger_end_sample: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegTrialRecord {
    pub study_stage: String,
    pub paradigm_session: String,
    pub subject_id: String,
    pub session_run_id: String,
    pub feedback_enabled: bool,
    pub trial_id: String,
    pub paradigm_emotion: String,
    pub system_emotion: String,
    pub trigger_class: u8,
    pub video_id: String,
    pub video_path: String,
    pub eeg_start_sample: u64,
    pub eeg_end_sample: u64,
    pub trigger_start_sample: Option<u64>,
    pub trigger_end_sample: Option<u64>,
    pub started_at: String,
    pub ended_at: String,
    pub self_report_valence: Option<f32>,
    pub self_report_arousal: Option<f32>,
    pub self_report_dominance: Option<f32>,
    pub self_report_acceptance: Option<String>,
    pub label_source: Option<String>,
    pub artifact_flags: Vec<String>,
    pub operator_notes: Option<String>,
    pub completion_status: String,
}

#[derive(Debug)]
pub struct EegTrialState {
    study: EegStudySessionInput,
    active: Option<ActiveTrial>,
    pending: Option<PendingTrial>,
    completed_trial_ids: HashSet<String>,
    completed_count: u32,
    interrupted_count: u32,
}

#[derive(Debug, Clone)]
struct ActiveTrial {
    input: BeginEegTrialInput,
    current_phase: String,
    eeg_start_sample: u64,
    started_at: String,
    trigger_start_sample: Option<u64>,
    trigger_end_sample: Option<u64>,
}

#[derive(Debug)]
struct PendingTrial {
    active: ActiveTrial,
    eeg_end_sample: u64,
    ended_at: String,
}

impl EegTrialState {
    pub fn new(study: EegStudySessionInput) -> Result<Self, String> {
        validate_study_session(&study)?;
        Ok(Self {
            study,
            active: None,
            pending: None,
            completed_trial_ids: HashSet::new(),
            completed_count: 0,
            interrupted_count: 0,
        })
    }

    pub fn study(&self) -> &EegStudySessionInput {
        &self.study
    }

    pub fn completed_count(&self) -> u32 {
        self.completed_count
    }

    pub fn interrupted_count(&self) -> u32 {
        self.interrupted_count
    }

    pub fn begin(
        &mut self,
        input: BeginEegTrialInput,
        sample_index: u64,
        recorded_at: String,
    ) -> Result<EegTrialEvent, String> {
        if self.active.is_some() || self.pending.is_some() {
            return Err("Finish the current trial before starting another.".to_string());
        }
        validate_trial_identity(&input)?;
        if self.completed_trial_ids.contains(&input.trial_id) {
            return Err("Trial id has already been finalized in this session run.".to_string());
        }
        self.active = Some(ActiveTrial {
            input: input.clone(),
            current_phase: PHASES[0].to_string(),
            eeg_start_sample: sample_index,
            started_at: recorded_at.clone(),
            trigger_start_sample: None,
            trigger_end_sample: None,
        });
        Ok(event(
            "begin_trial",
            &input.trial_id,
            PHASES[0],
            sample_index,
            recorded_at,
            None,
            None,
        ))
    }

    pub fn mark_phase(
        &mut self,
        input: MarkEegTrialPhaseInput,
        sample_index: u64,
        recorded_at: String,
    ) -> Result<EegTrialEvent, String> {
        let active = self
            .active
            .as_mut()
            .ok_or_else(|| "No EEG trial is active.".to_string())?;
        require_trial_id(&active.input.trial_id, &input.trial_id)?;
        let current = phase_index(&active.current_phase)?;
        let next = phase_index(&input.phase)?;
        if next != current + 1 {
            return Err("Trial phases must advance in the configured order.".to_string());
        }
        active.current_phase = input.phase.clone();
        Ok(event(
            "phase",
            &input.trial_id,
            &input.phase,
            sample_index,
            recorded_at,
            active.trigger_start_sample,
            active.trigger_end_sample,
        ))
    }

    pub fn observe_trigger(&mut self, trigger: i32, sample_index: u64) {
        let Some(active) = self.active.as_mut() else {
            return;
        };
        if active.current_phase != "video" {
            return;
        }
        if trigger == active.input.trigger_class as i32 && active.trigger_start_sample.is_none() {
            active.trigger_start_sample = Some(sample_index);
        } else if trigger == 255
            && active.trigger_start_sample.is_some()
            && active.trigger_end_sample.is_none()
        {
            active.trigger_end_sample = Some(sample_index);
        }
    }

    pub fn end(
        &mut self,
        input: EndEegTrialInput,
        sample_index: u64,
        recorded_at: String,
    ) -> Result<EegTrialEvent, String> {
        let active = self
            .active
            .take()
            .ok_or_else(|| "No EEG trial is active.".to_string())?;
        if let Err(error) = require_trial_id(&active.input.trial_id, &input.trial_id) {
            self.active = Some(active);
            return Err(error);
        }
        if active.current_phase != "post_video_rest" {
            self.active = Some(active);
            return Err("End the trial only after post_video_rest.".to_string());
        }
        if sample_index <= active.eeg_start_sample {
            self.active = Some(active);
            return Err("Trial EEG end sample must follow its start sample.".to_string());
        }
        self.pending = Some(PendingTrial {
            active,
            eeg_end_sample: sample_index,
            ended_at: recorded_at.clone(),
        });
        Ok(event(
            "end_eeg",
            &input.trial_id,
            "self_report",
            sample_index,
            recorded_at,
            self.pending
                .as_ref()
                .and_then(|value| value.active.trigger_start_sample),
            self.pending
                .as_ref()
                .and_then(|value| value.active.trigger_end_sample),
        ))
    }

    pub fn finalize(&mut self, input: FinalizeEegTrialInput) -> Result<EegTrialRecord, String> {
        validate_outcome(&input)?;
        let pending = self
            .pending
            .as_ref()
            .ok_or_else(|| "No EEG trial is waiting for self-report.".to_string())?;
        require_trial_id(&pending.active.input.trial_id, &input.trial_id)?;
        let missing_trigger = pending.active.trigger_start_sample.is_none()
            || pending.active.trigger_end_sample.is_none();
        if missing_trigger && input.self_report_acceptance != "artifact_rejected" {
            return Err("Missing trigger markers require artifact_rejected.".to_string());
        }

        let pending = self.pending.take().expect("pending trial was checked");
        self.completed_trial_ids
            .insert(pending.active.input.trial_id.clone());
        self.completed_count += 1;
        Ok(record(&self.study, pending, Some(input), "completed"))
    }

    pub fn interrupt(
        &mut self,
        sample_index: u64,
        recorded_at: String,
        reason: &str,
    ) -> Option<EegTrialRecord> {
        let pending = if let Some(value) = self.pending.take() {
            value
        } else {
            let active = self.active.take()?;
            PendingTrial {
                active,
                eeg_end_sample: sample_index,
                ended_at: recorded_at,
            }
        };
        self.completed_trial_ids
            .insert(pending.active.input.trial_id.clone());
        self.interrupted_count += 1;
        let mut result = record(&self.study, pending, None, "interrupted");
        result.artifact_flags.push(reason.to_string());
        Some(result)
    }
}

pub fn validate_study_session(input: &EegStudySessionInput) -> Result<(), String> {
    if input.study_stage != CURRENT_PAPER_STAGE {
        return Err("Only current_paper study sessions are enabled.".to_string());
    }
    if !matches!(
        input.paradigm_session.as_str(),
        "personal_calibration" | "held_out_generation"
    ) {
        return Err("Only calibration and held-out generation sessions are enabled.".to_string());
    }
    if input.feedback_enabled {
        return Err("Feedback must be disabled for current-paper sessions.".to_string());
    }
    required_text(&input.subject_id, "Subject id")?;
    required_text(&input.session_run_id, "Session run id")
}

fn validate_trial_identity(input: &BeginEegTrialInput) -> Result<(), String> {
    required_text(&input.trial_id, "Trial id")?;
    required_text(&input.video_id, "Video id")?;
    required_text(&input.video_path, "Video path")?;
    let valid = matches!(
        (
            input.paradigm_emotion.as_str(),
            input.system_emotion.as_str(),
            input.trigger_class,
        ),
        ("depression", "sad", 1)
            | ("anxiety", "fear", 2)
            | ("calm", "neutral", 3)
            | ("happy", "happy", 4)
    );
    if valid {
        Ok(())
    } else {
        Err("Paradigm emotion, system emotion, and trigger class do not match.".to_string())
    }
}

fn validate_outcome(input: &FinalizeEegTrialInput) -> Result<(), String> {
    validate_scale(input.self_report_valence, "Self-report valence")?;
    validate_scale(input.self_report_arousal, "Self-report arousal")?;
    if let Some(value) = input.self_report_dominance {
        validate_scale(value, "Self-report dominance")?;
    }
    if !matches!(
        input.self_report_acceptance.as_str(),
        "accepted" | "uncertain" | "rejected" | "artifact_rejected"
    ) {
        return Err("Self-report acceptance is invalid.".to_string());
    }
    if !matches!(
        input.label_source.as_str(),
        "induction_target" | "self_report_confirmed" | "model_prediction"
    ) {
        return Err("Label source is invalid.".to_string());
    }
    if input.self_report_acceptance == "artifact_rejected" && input.artifact_flags.is_empty() {
        return Err("Artifact-rejected trials require at least one artifact flag.".to_string());
    }
    if input
        .artifact_flags
        .iter()
        .any(|value| value.trim().is_empty())
    {
        return Err("Artifact flags cannot be empty.".to_string());
    }
    Ok(())
}

fn record(
    study: &EegStudySessionInput,
    pending: PendingTrial,
    outcome: Option<FinalizeEegTrialInput>,
    completion_status: &str,
) -> EegTrialRecord {
    let (valence, arousal, dominance, acceptance, label_source, flags, notes) = match outcome {
        Some(value) => (
            Some(value.self_report_valence),
            Some(value.self_report_arousal),
            value.self_report_dominance,
            Some(value.self_report_acceptance),
            Some(value.label_source),
            value.artifact_flags,
            value.operator_notes,
        ),
        None => (None, None, None, None, None, Vec::new(), None),
    };
    EegTrialRecord {
        study_stage: study.study_stage.clone(),
        paradigm_session: study.paradigm_session.clone(),
        subject_id: study.subject_id.clone(),
        session_run_id: study.session_run_id.clone(),
        feedback_enabled: study.feedback_enabled,
        trial_id: pending.active.input.trial_id,
        paradigm_emotion: pending.active.input.paradigm_emotion,
        system_emotion: pending.active.input.system_emotion,
        trigger_class: pending.active.input.trigger_class,
        video_id: pending.active.input.video_id,
        video_path: pending.active.input.video_path,
        eeg_start_sample: pending.active.eeg_start_sample,
        eeg_end_sample: pending.eeg_end_sample,
        trigger_start_sample: pending.active.trigger_start_sample,
        trigger_end_sample: pending.active.trigger_end_sample,
        started_at: pending.active.started_at,
        ended_at: pending.ended_at,
        self_report_valence: valence,
        self_report_arousal: arousal,
        self_report_dominance: dominance,
        self_report_acceptance: acceptance,
        label_source,
        artifact_flags: flags,
        operator_notes: notes,
        completion_status: completion_status.to_string(),
    }
}

fn event(
    kind: &str,
    trial_id: &str,
    phase: &str,
    sample: u64,
    at: String,
    trigger_start_sample: Option<u64>,
    trigger_end_sample: Option<u64>,
) -> EegTrialEvent {
    EegTrialEvent {
        event_type: kind.to_string(),
        trial_id: trial_id.to_string(),
        phase: phase.to_string(),
        sample_index: sample,
        recorded_at: at,
        trigger_start_sample,
        trigger_end_sample,
    }
}

fn phase_index(phase: &str) -> Result<usize, String> {
    PHASES
        .iter()
        .position(|value| *value == phase)
        .ok_or_else(|| "Trial phase is invalid.".to_string())
}

fn require_trial_id(expected: &str, actual: &str) -> Result<(), String> {
    if expected == actual {
        Ok(())
    } else {
        Err("Trial id does not match the active trial.".to_string())
    }
}

fn validate_scale(value: f32, label: &str) -> Result<(), String> {
    if value.is_finite() && (1.0..=9.0).contains(&value) {
        Ok(())
    } else {
        Err(format!("{label} must be between 1 and 9."))
    }
}

fn required_text(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required."))
    } else {
        Ok(())
    }
}

#[cfg(test)]
#[path = "trial_tests.rs"]
mod tests;

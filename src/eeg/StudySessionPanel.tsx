import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Slider,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { useEegSession } from './EegSessionContext';
import { useEegStudySession } from './EegStudySessionContext';
import {
  STUDY_ARTIFACT_FLAGS,
  STUDY_TRIAL_COUNT,
  shouldRevealStudyTarget,
  type StudyArtifactFlag,
  type StudyProtocolPhase,
  type StudyQuality,
} from './studySessionState';
import styles from './StudySessionPanel.module.css';

const phaseLabels: Record<StudyProtocolPhase, string> = {
  baseline_rest: 'Baseline rest',
  post_video_rest: 'Post-video rest',
  pre_video_hint: 'Starting hint',
  quality_check: 'Quality check',
  ready: 'Ready',
  self_report: 'Self-report',
  video: 'Video stimulus',
};

const artifactLabels: Record<StudyArtifactFlag, string> = {
  channel_dropout: 'Channel dropout',
  eeg_gap: 'EEG data gap',
  excessive_movement: 'Movement / talking',
  operator_interruption: 'Operator interruption',
  self_report_timeout: 'Self-report timeout',
  trigger_missing: 'Trigger missing',
  video_playback_failure: 'Video playback failure',
};

const qualityLabels: Record<StudyQuality, string> = {
  accepted: 'Accepted',
  artifact_rejected: 'Artifact rejected',
  rejected: 'Rejected',
  uncertain: 'Uncertain',
};

const sliderMarks = [1, 3, 5, 7, 9].map((value) => ({ label: String(value), value }));

function StimulusStage() {
  const study = useEegStudySession();
  const trial = study.currentTrial;

  if (!trial) return null;

  if (study.run.phase === 'ready') {
    return (
      <div className={styles.readyStage}>
        <span>Trial {study.run.completedTrialCount + 1} of {STUDY_TRIAL_COUNT}</span>
        <Button
          variant="contained"
          startIcon={<PlayArrowRoundedIcon />}
          disabled={study.busy}
          onClick={() => void study.beginTrial()}
        >
          Begin Trial
        </Button>
      </div>
    );
  }

  if (study.run.phase === 'baseline_rest' || study.run.phase === 'post_video_rest') {
    return (
      <div className={styles.restStage} aria-label={phaseLabels[study.run.phase]}>
        <span aria-hidden="true" />
      </div>
    );
  }

  if (study.run.phase === 'pre_video_hint') {
    return (
      <div className={styles.hintStage}>
        <strong>Get ready</strong>
        <span>The video will start shortly.</span>
      </div>
    );
  }

  if (study.run.phase === 'video') {
    return (
      <div className={styles.videoStage}>
        <video
          key={trial.videoPath}
          autoPlay
          playsInline
          src={convertFileSrc(trial.videoPath)}
          onError={study.markVideoPlaybackFailure}
        />
      </div>
    );
  }

  return null;
}

function SelfReportForm() {
  const study = useEegStudySession();

  return (
    <div className={styles.reportForm}>
      <div className={styles.scaleField}>
        <div><strong>Valence</strong><span>1 negative · 5 neutral · 9 positive</span></div>
        <Slider
          min={1}
          max={9}
          marks={sliderMarks}
          step={1}
          value={study.selfReport.valence}
          valueLabelDisplay="on"
          onChange={(_, value) => study.setSelfReport('valence', value as number)}
        />
      </div>
      <div className={styles.scaleField}>
        <div><strong>Arousal</strong><span>1 calm · 5 medium · 9 activated</span></div>
        <Slider
          min={1}
          max={9}
          marks={sliderMarks}
          step={1}
          value={study.selfReport.arousal}
          valueLabelDisplay="on"
          onChange={(_, value) => study.setSelfReport('arousal', value as number)}
        />
      </div>
      <TextField
        select
        size="small"
        label="Dominance (optional)"
        value={study.selfReport.dominance ?? ''}
        onChange={(event) => study.setSelfReport(
          'dominance',
          event.target.value === '' ? null : Number(event.target.value),
        )}
      >
        <MenuItem value="">Not recorded</MenuItem>
        {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
          <MenuItem key={value} value={value}>{value}</MenuItem>
        ))}
      </TextField>
      <Button variant="contained" disabled={study.busy} onClick={study.completeSelfReport}>
        Continue to Quality Check
      </Button>
    </div>
  );
}

function QualityForm() {
  const study = useEegStudySession();
  const trial = study.currentTrial;
  if (!trial) return null;
  const hasArtifacts = study.quality.artifactFlags.length > 0;

  return (
    <div className={styles.qualityForm}>
      <div className={styles.targetReview}>
        <span>Induction target</span>
        <strong>{trial.displayName} → {trial.systemEmotion}</strong>
        <code>trigger {trial.triggerClass} · {trial.videoId}</code>
      </div>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={hasArtifacts ? 'artifact_rejected' : study.quality.acceptance}
        onChange={(_, value: StudyQuality | null) => {
          if (value && !hasArtifacts) study.setQuality(value);
        }}
        aria-label="Trial quality"
      >
        {(['accepted', 'uncertain', 'rejected', 'artifact_rejected'] as StudyQuality[]).map((value) => (
          <ToggleButton
            key={value}
            value={value}
            disabled={value === 'artifact_rejected' ? !hasArtifacts : hasArtifacts}
          >
            {qualityLabels[value]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <div className={styles.artifactGrid}>
        {STUDY_ARTIFACT_FLAGS.map((flag) => (
          <FormControlLabel
            key={flag}
            control={(
              <Checkbox
                size="small"
                checked={study.quality.artifactFlags.includes(flag)}
                onChange={() => study.toggleArtifactFlag(flag)}
              />
            )}
            label={artifactLabels[flag]}
          />
        ))}
      </div>

      <TextField
        multiline
        minRows={2}
        size="small"
        label="Operator notes"
        value={study.quality.operatorNotes}
        onChange={(event) => study.setOperatorNotes(event.target.value)}
      />
      <Button
        variant="contained"
        startIcon={<CheckCircleRoundedIcon />}
        disabled={study.busy}
        onClick={() => void study.finalizeTrial()}
      >
        Finalize Trial
      </Button>
    </div>
  );
}

function SetupPanel() {
  const eeg = useEegSession();
  const study = useEegStudySession();
  const sessionFinished = study.run.status === 'complete' || study.run.status === 'aborted';

  if (sessionFinished) {
    return (
      <div className={styles.sessionResult}>
        <div>
          <strong>{study.run.status === 'complete' ? 'Session completed' : 'Session ended early'}</strong>
          <span>{study.run.completedTrialCount} / {STUDY_TRIAL_COUNT} trials finalized</span>
        </div>
        <Button variant="outlined" onClick={study.resetSession}>New Session</Button>
      </div>
    );
  }

  return (
    <div className={styles.setupGrid}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={study.setup.paradigmSession}
        onChange={(_, value) => value && study.updateSetup('paradigmSession', value)}
        aria-label="Study session"
      >
        <ToggleButton value="personal_calibration">Session A · Calibration</ToggleButton>
        <ToggleButton value="held_out_generation">Session B · Held-out</ToggleButton>
      </ToggleButtonGroup>
      <TextField
        size="small"
        label="Subject ID"
        value={study.setup.subjectId}
        onChange={(event) => study.updateSetup('subjectId', event.target.value)}
      />
      <TextField
        size="small"
        label="Session run ID"
        value={study.setup.sessionRunId}
        onChange={(event) => study.updateSetup('sessionRunId', event.target.value)}
      />
      <div className={styles.libraryPicker}>
        <Button
          variant="outlined"
          startIcon={<FolderOpenRoundedIcon />}
          disabled={study.busy}
          onClick={() => void study.chooseVideoLibrary()}
        >
          Study Videos
        </Button>
        <span>{study.videoLibrary?.root ?? 'No validated video root'}</span>
        <strong>{study.videoLibrary ? `${study.videoLibrary.assets.length} videos` : '4 classes × 5 required'}</strong>
      </div>
      <div className={styles.connectionChecks}>
        <span className={eeg.deviceStatus === 'streaming' ? styles.checkOk : styles.checkPending}>
          EEG {eeg.deviceStatus}
        </span>
        <span className={eeg.triggerConnected ? styles.checkOk : styles.checkPending}>
          Trigger {eeg.triggerConnected ? 'connected' : 'waiting'}
        </span>
        <span className={styles.checkOk}>Feedback off</span>
      </div>
      <Button
        variant="contained"
        startIcon={<PlayArrowRoundedIcon />}
        disabled={study.busy || !eeg.canStartRecord}
        onClick={() => void study.startSession()}
      >
        Start 20-Trial Session
      </Button>
    </div>
  );
}

export default function StudySessionPanel() {
  const study = useEegStudySession();
  const progress = (study.run.completedTrialCount / STUDY_TRIAL_COUNT) * 100;
  const active = study.navigationLocked;
  const showTarget = shouldRevealStudyTarget(study.run.phase);

  return (
    <section className={`${styles.studyPanel} ${active ? styles.activeStudyPanel : ''}`} aria-label="EEG study session">
      <header className={styles.studyHeader}>
        <div>
          <span className={styles.eyebrow}>Current-paper protocol</span>
          <h2>Session A/B Study</h2>
        </div>
        <div className={styles.studyStatus}>
          {active ? <strong>{study.run.completedTrialCount}/{STUDY_TRIAL_COUNT}</strong> : null}
          <span>{active ? phaseLabels[study.run.phase] : 'Feedback disabled'}</span>
          {study.phaseSecondsRemaining !== null ? <b>{study.phaseSecondsRemaining}s</b> : null}
          {active ? (
            <Button
              color="error"
              size="small"
              variant="outlined"
              startIcon={<StopRoundedIcon />}
              disabled={study.busy}
              onClick={() => {
                if (window.confirm('End this study session? An active trial will be recorded as interrupted.')) {
                  void study.abortSession();
                }
              }}
            >
              End Session
            </Button>
          ) : null}
        </div>
      </header>

      {active ? <LinearProgress variant="determinate" value={progress} /> : null}

      {study.errorMessage ? (
        <div className={styles.studyError}>
          <WarningAmberRoundedIcon fontSize="small" />
          <span>{study.errorMessage}</span>
          {active && study.phaseSecondsRemaining === 0 ? (
            <Button size="small" onClick={() => void study.advanceTimedPhase()}>Retry phase</Button>
          ) : null}
        </div>
      ) : null}

      {!active ? <SetupPanel /> : (
        <div className={styles.activeRunGrid}>
          <div className={styles.stimulusColumn}>
            <div className={styles.trialMeta}>
              <span>Trial {study.run.completedTrialCount + 1}</span>
              <code>{study.currentTrial?.trialId}</code>
              {showTarget ? <strong>{study.currentTrial?.displayName}</strong> : null}
            </div>
            <StimulusStage />
          </div>
          {study.run.phase === 'self_report' ? <SelfReportForm /> : null}
          {study.run.phase === 'quality_check' ? <QualityForm /> : null}
          {!['self_report', 'quality_check'].includes(study.run.phase) ? (
            <aside className={styles.protocolRail}>
              {(['baseline_rest', 'pre_video_hint', 'video', 'post_video_rest', 'self_report', 'quality_check'] as StudyProtocolPhase[])
                .map((phase, index) => (
                  <div key={phase} className={study.run.phase === phase ? styles.currentPhase : ''}>
                    <span>{index + 1}</span>
                    <strong>{phaseLabels[phase]}</strong>
                  </div>
                ))}
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}

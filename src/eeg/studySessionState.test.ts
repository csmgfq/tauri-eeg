import { describe, expect, it } from 'vitest';
import {
  STUDY_TRIAL_COUNT,
  createStudySessionInput,
  createStudyTrialQueue,
  getNextTimedPhase,
  getPhaseSecondsRemaining,
  getSuggestedStudyQuality,
  initialStudyRunState,
  shouldRevealStudyTarget,
  studyRunReducer,
} from './studySessionState';

describe('study session trial queue', () => {
  it('builds a deterministic balanced 20-trial queue from the session run id', () => {
    const first = createStudyTrialQueue('sub-001-session-a');
    const repeated = createStudyTrialQueue('sub-001-session-a');
    const different = createStudyTrialQueue('sub-001-session-b');

    expect(first).toEqual(repeated);
    expect(first).toHaveLength(STUDY_TRIAL_COUNT);
    expect(first.map((trial) => trial.videoId)).not.toEqual(different.map((trial) => trial.videoId));
    expect(new Set(first.map((trial) => trial.trialId))).toHaveLength(STUDY_TRIAL_COUNT);

    const classCounts = first.reduce<Record<string, number>>((counts, trial) => ({
      ...counts,
      [trial.paradigmEmotion]: (counts[trial.paradigmEmotion] ?? 0) + 1,
    }), {});
    expect(classCounts).toEqual({ anxiety: 5, calm: 5, depression: 5, happy: 5 });
    expect(first.every((trial) => trial.videoPath.startsWith('database/'))).toBe(true);
  });

  it('locks current-paper sessions to feedback false', () => {
    expect(createStudySessionInput(
      'held_out_generation',
      ' sub-001 ',
      ' sub-001-session-b ',
    )).toEqual({
      feedbackEnabled: false,
      paradigmSession: 'held_out_generation',
      sessionRunId: 'sub-001-session-b',
      studyStage: 'current_paper',
      subjectId: 'sub-001',
    });
  });
});

describe('study session phase state machine', () => {
  it('freezes EEG before opening self-report and advances only after finalize', () => {
    const queue = createStudyTrialQueue('run-001');
    const recording = studyRunReducer(initialStudyRunState, { type: 'session_started', queue });
    const baseline = studyRunReducer(recording, { type: 'trial_started', startedAtMs: 1000 });
    const hint = studyRunReducer(baseline, {
      type: 'phase_advanced',
      phase: 'pre_video_hint',
      startedAtMs: 6000,
    });
    const video = studyRunReducer(hint, {
      type: 'phase_advanced',
      phase: 'video',
      startedAtMs: 8000,
    });
    const rest = studyRunReducer(video, {
      type: 'phase_advanced',
      phase: 'post_video_rest',
      startedAtMs: 53000,
    });
    const selfReport = studyRunReducer(rest, { type: 'eeg_ended', startedAtMs: 58000 });

    expect(getNextTimedPhase('baseline_rest')).toBe('pre_video_hint');
    expect(getNextTimedPhase('post_video_rest')).toBe('self_report');
    expect(selfReport.phase).toBe('self_report');
    expect(selfReport.completedTrialCount).toBe(0);

    const quality = studyRunReducer(selfReport, { type: 'quality_check_opened' });
    const finalized = studyRunReducer(quality, {
      type: 'trial_finalized',
      record: {
        completionStatus: 'completed',
        eegEndSample: 1000,
        eegStartSample: 0,
        feedbackEnabled: false,
        paradigmSession: 'personal_calibration',
        selfReportAcceptance: 'accepted',
        sessionRunId: 'run-001',
        studyStage: 'current_paper',
        subjectId: 'sub-001',
        trialId: queue[0].trialId,
        triggerEndSample: 900,
        triggerStartSample: 100,
      },
    });

    expect(finalized.phase).toBe('ready');
    expect(finalized.completedTrialCount).toBe(1);
    expect(finalized.currentTrialIndex).toBe(1);
  });

  it('calculates countdowns without exposing the target before quality review', () => {
    expect(getPhaseSecondsRemaining('video', 1000, 44000)).toBe(2);
    expect(getPhaseSecondsRemaining('self_report', 1000, 32000)).toBe(0);
    expect(getPhaseSecondsRemaining('self_report', 2000, 1500)).toBe(30);
    expect(shouldRevealStudyTarget('baseline_rest')).toBe(false);
    expect(shouldRevealStudyTarget('self_report')).toBe(false);
    expect(shouldRevealStudyTarget('quality_check')).toBe(true);
  });

  it('rejects duplicate ticks and out-of-order UI transitions', () => {
    const queue = createStudyTrialQueue('run-guard');
    const recording = studyRunReducer(initialStudyRunState, { type: 'session_started', queue });
    const baseline = studyRunReducer(recording, { type: 'trial_started', startedAtMs: 1000 });

    expect(studyRunReducer(baseline, {
      type: 'phase_advanced',
      phase: 'video',
      startedAtMs: 2000,
    })).toBe(baseline);
    expect(studyRunReducer(baseline, { type: 'eeg_ended', startedAtMs: 2000 })).toBe(baseline);
    expect(studyRunReducer(baseline, { type: 'quality_check_opened' })).toBe(baseline);

    const hint = studyRunReducer(baseline, {
      type: 'phase_advanced',
      phase: 'pre_video_hint',
      startedAtMs: 6000,
    });
    expect(studyRunReducer(hint, {
      type: 'phase_advanced',
      phase: 'pre_video_hint',
      startedAtMs: 6001,
    })).toBe(hint);
  });
});

describe('study self-report quality contract', () => {
  it('implements the configured four-class acceptance boundaries', () => {
    expect(getSuggestedStudyQuality('depression', 4, 5)).toBe('accepted');
    expect(getSuggestedStudyQuality('depression', 5, 4)).toBe('uncertain');
    expect(getSuggestedStudyQuality('anxiety', 4, 6)).toBe('accepted');
    expect(getSuggestedStudyQuality('anxiety', 5, 7)).toBe('uncertain');
    expect(getSuggestedStudyQuality('calm', 5, 4)).toBe('accepted');
    expect(getSuggestedStudyQuality('calm', 7, 6)).toBe('rejected');
    expect(getSuggestedStudyQuality('happy', 6, 8)).toBe('accepted');
    expect(getSuggestedStudyQuality('happy', 7, 9)).toBe('uncertain');
  });
});

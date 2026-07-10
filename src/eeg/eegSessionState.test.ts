import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  beginEegTrial,
  endEegTrial,
  finalizeEegTrial,
  getEegStatus,
  listEegSessions,
  loadEegStudyVideoLibrary,
  markEegTrialPhase,
  startEegRecording,
  stopEegStream,
  stopEegRecording,
} from './eegApi';
import {
  canPauseRecord,
  canResumeRecord,
  canStartDevice,
  canStartRecord,
  canStopDevice,
  canStopRecord,
  eegSessionReducer,
  initialEegSessionState,
} from './eegSessionState';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('eegSessionReducer', () => {
  it('starts the device once and enters previewing without recording', () => {
    const starting = eegSessionReducer(initialEegSessionState, { type: 'start_device_requested' });
    const previewing = eegSessionReducer(starting, { type: 'start_device_succeeded' });

    expect(starting).toMatchObject({ deviceStatus: 'starting', recordStatus: 'idle' });
    expect(previewing).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'idle' });
    expect(canStartDevice(previewing)).toBe(false);
    expect(canStartRecord(previewing)).toBe(true);
  });

  it('treats stop as stopping the current recording segment, not the device stream', () => {
    const streaming = { ...initialEegSessionState, deviceStatus: 'streaming' as const };
    const recording = eegSessionReducer(streaming, { type: 'start_record' });
    const stopped = eegSessionReducer(recording, { type: 'stop_record' });

    expect(recording).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'recording' });
    expect(stopped).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'stopped' });
    expect(canStartDevice(stopped)).toBe(false);
    expect(canStartRecord(stopped)).toBe(true);
  });

  it('stops the device stream by disconnecting the TCP server', () => {
    const streaming = {
      ...initialEegSessionState,
      deviceStatus: 'streaming' as const,
      recordStatus: 'recording' as const,
    };
    const stopping = eegSessionReducer(streaming, { type: 'stop_device_requested' });
    const disconnected = eegSessionReducer(stopping, { type: 'stop_device_succeeded' });

    expect(stopping).toMatchObject({
      deviceStatus: 'stopping',
      recordStatus: 'recording',
      errorMessage: null,
    });
    expect(disconnected).toMatchObject({
      deviceStatus: 'disconnected',
      recordStatus: 'idle',
      errorMessage: null,
    });
    expect(canStartDevice(disconnected)).toBe(true);
    expect(canStopDevice(disconnected)).toBe(false);
  });

  it('can stop the TCP server while waiting for the first EEG frame', () => {
    const starting = {
      ...initialEegSessionState,
      deviceStatus: 'starting' as const,
    };
    const stopping = eegSessionReducer(starting, { type: 'stop_device_requested' });

    expect(canStartDevice(starting)).toBe(true);
    expect(canStopDevice(starting)).toBe(true);
    expect(stopping).toMatchObject({
      deviceStatus: 'stopping',
      recordStatus: 'idle',
      errorMessage: null,
    });
  });

  it('pauses and resumes recording while the device keeps streaming', () => {
    const recording = {
      ...initialEegSessionState,
      deviceStatus: 'streaming' as const,
      recordStatus: 'recording' as const,
    };
    const paused = eegSessionReducer(recording, { type: 'pause_record' });
    const resumed = eegSessionReducer(paused, { type: 'resume_record' });

    expect(paused).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'paused' });
    expect(canPauseRecord(paused)).toBe(false);
    expect(canResumeRecord(paused)).toBe(true);
    expect(resumed).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'recording' });
  });

  it('exposes button guards for each state', () => {
    const disconnected = initialEegSessionState;
    const starting = { ...initialEegSessionState, deviceStatus: 'starting' as const };
    const streamingIdle = { ...initialEegSessionState, deviceStatus: 'streaming' as const };
    const stopping = { ...initialEegSessionState, deviceStatus: 'stopping' as const };
    const recording = { ...streamingIdle, recordStatus: 'recording' as const };

    expect(canStartDevice(disconnected)).toBe(true);
    expect(canStartDevice(starting)).toBe(true);
    expect(canStartDevice(stopping)).toBe(false);
    expect(canStopDevice(starting)).toBe(true);
    expect(canStopDevice(streamingIdle)).toBe(true);
    expect(canStopDevice(stopping)).toBe(false);
    expect(canStartRecord(disconnected)).toBe(false);
    expect(canStartRecord(streamingIdle)).toBe(true);
    expect(canPauseRecord(recording)).toBe(true);
    expect(canStopRecord(recording)).toBe(true);
  });

  it('keeps streaming idle and exposes an error when recording fails to start', () => {
    const streaming = { ...initialEegSessionState, deviceStatus: 'streaming' as const };
    const failed = eegSessionReducer(streaming, {
      type: 'start_record_failed',
      message: 'Sign in before recording EEG.',
    });

    expect(failed).toMatchObject({
      deviceStatus: 'streaming',
      recordStatus: 'idle',
      errorMessage: 'Sign in before recording EEG.',
    });
    expect(canStartRecord(failed)).toBe(true);
  });
});

describe('eegApi recording commands', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('starts recording with the current user identity', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await startEegRecording({ userId: 'user-1', username: 'alice' });

    expect(invoke).toHaveBeenCalledWith('start_eeg_recording', {
      input: {
        userId: 'user-1',
        username: 'alice',
      },
    });
  });

  it('starts and completes a current-paper trial with auditable metadata', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const studySession = {
      studyStage: 'current_paper' as const,
      paradigmSession: 'held_out_generation' as const,
      subjectId: 'sub-001',
      sessionRunId: 'sub-001-session-b',
      feedbackEnabled: false as const,
    };
    const trial = {
      trialId: 'trial-001',
      paradigmEmotion: 'anxiety' as const,
      systemEmotion: 'fear' as const,
      triggerClass: 2 as const,
      videoId: 'anxiety-01',
      videoPath: 'database/Anxiety/anxiety-01.mp4',
    };
    const outcome = {
      trialId: 'trial-001',
      selfReportValence: 3,
      selfReportArousal: 7,
      selfReportDominance: 4,
      selfReportAcceptance: 'accepted' as const,
      labelSource: 'self_report_confirmed' as const,
      artifactFlags: [],
      operatorNotes: 'clean trial',
    };

    await startEegRecording({ userId: 'user-1', username: 'alice', studySession });
    await beginEegTrial(trial);
    await markEegTrialPhase({ trialId: 'trial-001', phase: 'pre_video_hint' });
    await markEegTrialPhase({ trialId: 'trial-001', phase: 'video' });
    await markEegTrialPhase({ trialId: 'trial-001', phase: 'post_video_rest' });
    await endEegTrial({ trialId: 'trial-001' });
    await finalizeEegTrial(outcome);

    expect(invoke).toHaveBeenNthCalledWith(1, 'start_eeg_recording', {
      input: { userId: 'user-1', username: 'alice', studySession },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'begin_eeg_trial', { input: trial });
    expect(invoke).toHaveBeenNthCalledWith(6, 'end_eeg_trial', {
      input: { trialId: 'trial-001' },
    });
    expect(invoke).toHaveBeenNthCalledWith(7, 'finalize_eeg_trial', { input: outcome });
  });

  it('wraps recording status and session list commands', async () => {
    const stoppedSession = { id: 'session-1' };
    vi.mocked(invoke)
      .mockResolvedValueOnce(stoppedSession)
      .mockResolvedValueOnce({ isRecording: false })
      .mockResolvedValueOnce([]);

    await expect(stopEegRecording()).resolves.toBe(stoppedSession);
    await getEegStatus();
    await listEegSessions('user-1');
    await stopEegStream();

    expect(invoke).toHaveBeenNthCalledWith(1, 'stop_eeg_recording');
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_eeg_status');
    expect(invoke).toHaveBeenNthCalledWith(3, 'list_eeg_sessions', { userId: 'user-1' });
    expect(invoke).toHaveBeenNthCalledWith(4, 'stop_eeg_stream');
  });

  it('loads a validated four-class study video library', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ assets: [], root: 'D:\\study' });

    await loadEegStudyVideoLibrary('D:\\study');

    expect(invoke).toHaveBeenCalledWith('load_eeg_study_video_library', {
      folderPath: 'D:\\study',
    });
  });
});

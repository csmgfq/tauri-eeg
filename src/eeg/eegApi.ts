import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  BeginEegTrialInput,
  EegTrialEvent,
  EegTrialRecord,
  EegRecordingSession,
  EegSampleBlockPayload,
  EegStatus,
  EegStreamConfig,
  EegStreamInfo,
  EegStudyVideoLibrary,
  EndEegTrialInput,
  FinalizeEegTrialInput,
  MarkEegTrialPhaseInput,
  StartEegRecordingRequest,
} from './types';

export const EEG_SAMPLE_BLOCK_EVENT = 'eeg://sample-block';

export function startEegStream(config?: Partial<EegStreamConfig>) {
  return invoke<EegStreamInfo>('start_eeg_stream', { config: config ?? null });
}

export function stopEegStream() {
  return invoke<void>('stop_eeg_stream');
}

export function startEegRecording(request: StartEegRecordingRequest) {
  return invoke<EegRecordingSession>('start_eeg_recording', { input: request });
}

export function stopEegRecording() {
  return invoke<EegRecordingSession>('stop_eeg_recording');
}

export function beginEegTrial(input: BeginEegTrialInput) {
  return invoke<EegTrialEvent>('begin_eeg_trial', { input });
}

export function markEegTrialPhase(input: MarkEegTrialPhaseInput) {
  return invoke<EegTrialEvent>('mark_eeg_trial_phase', { input });
}

export function endEegTrial(input: EndEegTrialInput) {
  return invoke<EegTrialEvent>('end_eeg_trial', { input });
}

export function finalizeEegTrial(input: FinalizeEegTrialInput) {
  return invoke<EegTrialRecord>('finalize_eeg_trial', { input });
}

export function loadEegStudyVideoLibrary(folderPath: string) {
  return invoke<EegStudyVideoLibrary>('load_eeg_study_video_library', { folderPath });
}

export function getEegStatus() {
  return invoke<EegStatus>('get_eeg_status');
}

export function listEegSessions(userId: string) {
  return invoke<EegRecordingSession[]>('list_eeg_sessions', { userId });
}

export function listenToEegSampleBlocks(
  onBlock: (payload: EegSampleBlockPayload) => void,
) {
  return listen<EegSampleBlockPayload>(EEG_SAMPLE_BLOCK_EVENT, (event) => {
    onBlock(event.payload);
  });
}

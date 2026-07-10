export type EegChannel = {
  id: string;
  label: string;
  unit: 'uV';
};

export type EegStreamInfo = {
  bindHost: string;
  tcpPort: number;
  sampleRateHz: number;
  blockIntervalMs: number;
  channelIds: string[];
};

export type EegStreamConfig = {
  bindHost: string;
  tcpPort: number;
  deviceHost: string;
  deviceUdpPort: number;
  eegDeviceIp: string;
  triggerDeviceIp: string;
  sampleRateHz: number;
  blockIntervalMs: number;
};

export type StartEegRecordingRequest = {
  userId: string;
  username: string;
  studySession?: EegStudySessionInput;
};

export type EegStudyStage = 'current_paper';

export type EegParadigmSession = 'personal_calibration' | 'held_out_generation';

export type EegStudySessionInput = {
  studyStage: 'current_paper';
  paradigmSession: EegParadigmSession;
  subjectId: string;
  sessionRunId: string;
  feedbackEnabled: false;
};

export type EegStudyVideoAsset = {
  displayName: string;
  paradigmEmotion: BeginEegTrialInput['paradigmEmotion'];
  systemEmotion: BeginEegTrialInput['systemEmotion'];
  triggerClass: BeginEegTrialInput['triggerClass'];
  videoId: string;
  videoPath: string;
};

export type EegStudyVideoLibrary = {
  assets: EegStudyVideoAsset[];
  root: string;
};

export type BeginEegTrialInput = {
  trialId: string;
  paradigmEmotion: 'depression' | 'anxiety' | 'calm' | 'happy';
  systemEmotion: 'sad' | 'fear' | 'neutral' | 'happy';
  triggerClass: 1 | 2 | 3 | 4;
  videoId: string;
  videoPath: string;
};

export type EegTrialPhase =
  | 'baseline_rest'
  | 'pre_video_hint'
  | 'video'
  | 'post_video_rest';

export type MarkEegTrialPhaseInput = {
  trialId: string;
  phase: EegTrialPhase;
};

export type EndEegTrialInput = {
  trialId: string;
};

export type FinalizeEegTrialInput = {
  trialId: string;
  selfReportValence: number;
  selfReportArousal: number;
  selfReportDominance?: number | null;
  selfReportAcceptance: 'accepted' | 'uncertain' | 'rejected' | 'artifact_rejected';
  labelSource: 'induction_target' | 'self_report_confirmed' | 'model_prediction';
  artifactFlags?: string[];
  operatorNotes?: string | null;
};

export type EegTrialEvent = {
  eventType: 'begin_trial' | 'phase' | 'end_eeg' | string;
  trialId: string;
  phase: EegTrialPhase | 'self_report' | string;
  sampleIndex: number;
  recordedAt: string;
  triggerStartSample: number | null;
  triggerEndSample: number | null;
};

export type EegTrialRecord = {
  studyStage: 'current_paper';
  paradigmSession: EegParadigmSession;
  subjectId: string;
  sessionRunId: string;
  feedbackEnabled: false;
  trialId: string;
  paradigmEmotion?: BeginEegTrialInput['paradigmEmotion'];
  systemEmotion?: BeginEegTrialInput['systemEmotion'];
  triggerClass?: BeginEegTrialInput['triggerClass'];
  videoId?: string;
  videoPath?: string;
  eegStartSample: number;
  eegEndSample: number;
  triggerStartSample: number | null;
  triggerEndSample: number | null;
  startedAt?: string;
  endedAt?: string;
  selfReportValence?: number | null;
  selfReportArousal?: number | null;
  selfReportDominance?: number | null;
  selfReportAcceptance: FinalizeEegTrialInput['selfReportAcceptance'] | null;
  labelSource?: FinalizeEegTrialInput['labelSource'] | null;
  artifactFlags?: string[];
  operatorNotes?: string | null;
  completionStatus: 'completed' | 'interrupted';
};

export type EegRecordingSession = {
  id: string;
  userId: string;
  username: string;
  sessionDir: string;
  eegFile: string;
  triggerFile: string;
  metadataFile: string;
  sampleRateHz: number;
  channelCount: number;
  sampleCount: number;
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
};

export type EegStatus = {
  isStreaming: boolean;
  isRecording: boolean;
  eegConnected: boolean;
  triggerConnected: boolean;
  lastError: string | null;
  sampleRateHz: number;
  blockIntervalMs: number;
  channelIds: string[];
  activeRecording: EegRecordingSession | null;
};

export type EegSampleBlockPayload = {
  sequence: number;
  sampleRateHz: number;
  startedAtMs: number;
  channelIds: string[];
  samples: number[][];
  triggerClass?: EegTriggerCode | null;
};

export type EegDisplaySettings = {
  timeWindowSeconds: number;
  amplitudeUvPerDiv: number;
  visibleChannelIds: Set<string>;
};

export type EegDisplaySnapshot = {
  latestSequence: number | null;
  x: number[];
  visibleChannels: EegChannel[];
  seriesByChannel: Record<string, number[]>;
  markers: EegMarker[];
  retainedSampleCount: number;
};

export type EegMarker = {
  timeSeconds: number;
  classId: EegTriggerCode;
};

export type EegTriggerCode = 1 | 2 | 3 | 4 | 255;

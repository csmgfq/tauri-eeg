import type {
  BeginEegTrialInput,
  EegParadigmSession,
  EegStudySessionInput,
  EegStudyVideoAsset,
  EegTrialPhase,
  EegTrialRecord,
  FinalizeEegTrialInput,
} from './types';

export const STUDY_TRIALS_PER_CLASS = 5;
export const STUDY_TRIAL_COUNT = 20;

export const STUDY_PHASE_DURATIONS_SECONDS = {
  baseline_rest: 5,
  pre_video_hint: 2,
  video: 45,
  post_video_rest: 5,
  self_report: 30,
} as const;

export const STUDY_ARTIFACT_FLAGS = [
  'excessive_movement',
  'channel_dropout',
  'eeg_gap',
  'trigger_missing',
  'video_playback_failure',
  'operator_interruption',
  'self_report_timeout',
] as const;

export type StudyArtifactFlag = typeof STUDY_ARTIFACT_FLAGS[number];
export type StudyQuality = FinalizeEegTrialInput['selfReportAcceptance'];
export type StudyProtocolPhase = EegTrialPhase | 'ready' | 'self_report' | 'quality_check';
export type StudyRunStatus = 'setup' | 'recording' | 'complete' | 'aborted';

export type StudyTrial = BeginEegTrialInput & {
  classTrialNumber: number;
  displayName: string;
};

export type StudyRunState = {
  completedTrialCount: number;
  currentTrialIndex: number;
  lastRecord: EegTrialRecord | null;
  phase: StudyProtocolPhase;
  phaseStartedAtMs: number | null;
  queue: StudyTrial[];
  status: StudyRunStatus;
};

export type StudyRunAction =
  | { type: 'session_started'; queue: StudyTrial[] }
  | { type: 'trial_started'; startedAtMs: number }
  | { type: 'phase_advanced'; phase: EegTrialPhase; startedAtMs: number }
  | { type: 'eeg_ended'; startedAtMs: number }
  | { type: 'quality_check_opened' }
  | { type: 'trial_finalized'; record: EegTrialRecord }
  | { type: 'session_completed' }
  | { type: 'session_aborted' }
  | { type: 'reset' };

type EmotionDefinition = {
  displayName: string;
  folderName: string;
  paradigmEmotion: BeginEegTrialInput['paradigmEmotion'];
  systemEmotion: BeginEegTrialInput['systemEmotion'];
  triggerClass: BeginEegTrialInput['triggerClass'];
};

const EMOTIONS: readonly EmotionDefinition[] = [
  {
    displayName: 'Depression',
    folderName: 'Depression',
    paradigmEmotion: 'depression',
    systemEmotion: 'sad',
    triggerClass: 1,
  },
  {
    displayName: 'Anxiety',
    folderName: 'Anxiety',
    paradigmEmotion: 'anxiety',
    systemEmotion: 'fear',
    triggerClass: 2,
  },
  {
    displayName: 'Calm',
    folderName: 'Calm',
    paradigmEmotion: 'calm',
    systemEmotion: 'neutral',
    triggerClass: 3,
  },
  {
    displayName: 'Happy',
    folderName: 'Happy',
    paradigmEmotion: 'happy',
    systemEmotion: 'happy',
    triggerClass: 4,
  },
];

export const initialStudyRunState: StudyRunState = {
  completedTrialCount: 0,
  currentTrialIndex: 0,
  lastRecord: null,
  phase: 'ready',
  phaseStartedAtMs: null,
  queue: [],
  status: 'setup',
};

function hashSeed(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seedText: string) {
  let seed = hashSeed(seedText) || 0x6d2b79f5;

  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function joinStudyVideoPath(root: string, folder: string, file: string) {
  const separator = root.includes('\\') ? '\\' : '/';
  const normalizedRoot = root.trim().replace(/[\\/]+$/, '') || 'database';
  return [normalizedRoot, folder, file].join(separator);
}

function createDefaultStudyAssets(videoRoot: string): EegStudyVideoAsset[] {
  return EMOTIONS.flatMap((emotion) => (
    Array.from({ length: STUDY_TRIALS_PER_CLASS }, (_, index): EegStudyVideoAsset => {
      const classTrialNumber = index + 1;
      const suffix = String(classTrialNumber).padStart(2, '0');
      const videoId = `${emotion.paradigmEmotion}-${suffix}`;

      return {
        displayName: emotion.displayName,
        paradigmEmotion: emotion.paradigmEmotion,
        systemEmotion: emotion.systemEmotion,
        triggerClass: emotion.triggerClass,
        videoId,
        videoPath: joinStudyVideoPath(
          videoRoot,
          emotion.folderName,
          `${videoId}.mp4`,
        ),
      };
    })
  ));
}

function shuffled<T>(values: readonly T[], seedText: string) {
  const result = [...values];
  const random = createSeededRandom(seedText);

  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }

  return result;
}

export function createStudyTrialQueue(
  sessionRunId: string,
  assets: readonly EegStudyVideoAsset[] = createDefaultStudyAssets('database'),
) {
  const selected = EMOTIONS.flatMap((emotion) => {
    const classAssets = assets.filter((asset) => (
      asset.paradigmEmotion === emotion.paradigmEmotion
      && asset.systemEmotion === emotion.systemEmotion
      && asset.triggerClass === emotion.triggerClass
    ));

    if (classAssets.length < STUDY_TRIALS_PER_CLASS) {
      throw new Error(`${emotion.displayName} requires at least five study videos.`);
    }

    return shuffled(classAssets, `${sessionRunId}:${emotion.paradigmEmotion}`)
      .slice(0, STUDY_TRIALS_PER_CLASS)
      .map((asset, index): StudyTrial => ({
        ...asset,
        classTrialNumber: index + 1,
        trialId: `${sessionRunId}-${asset.videoId}`,
      }));
  });

  return shuffled(selected, sessionRunId);
}

export function createStudySessionInput(
  paradigmSession: EegParadigmSession,
  subjectId: string,
  sessionRunId: string,
): EegStudySessionInput {
  return {
    feedbackEnabled: false,
    paradigmSession,
    sessionRunId: sessionRunId.trim(),
    studyStage: 'current_paper',
    subjectId: subjectId.trim(),
  };
}

export function studyRunReducer(state: StudyRunState, action: StudyRunAction): StudyRunState {
  switch (action.type) {
    case 'session_started':
      if (state.status === 'recording' || action.queue.length !== STUDY_TRIAL_COUNT) return state;
      return {
        ...initialStudyRunState,
        queue: action.queue,
        status: 'recording',
      };

    case 'trial_started':
      if (
        state.status !== 'recording'
        || state.phase !== 'ready'
        || state.completedTrialCount >= state.queue.length
      ) return state;
      return {
        ...state,
        phase: 'baseline_rest',
        phaseStartedAtMs: action.startedAtMs,
      };

    case 'phase_advanced':
      if (
        !['baseline_rest', 'pre_video_hint', 'video'].includes(state.phase)
        || getNextTimedPhase(state.phase as EegTrialPhase) !== action.phase
      ) return state;
      return {
        ...state,
        phase: action.phase,
        phaseStartedAtMs: action.startedAtMs,
      };

    case 'eeg_ended':
      if (state.phase !== 'post_video_rest') return state;
      return {
        ...state,
        phase: 'self_report',
        phaseStartedAtMs: action.startedAtMs,
      };

    case 'quality_check_opened':
      if (state.phase !== 'self_report') return state;
      return { ...state, phase: 'quality_check' };

    case 'trial_finalized': {
      if (state.phase !== 'quality_check') return state;
      const completedTrialCount = state.completedTrialCount + 1;
      return {
        ...state,
        completedTrialCount,
        currentTrialIndex: Math.min(completedTrialCount, state.queue.length - 1),
        lastRecord: action.record,
        phase: 'ready',
        phaseStartedAtMs: null,
      };
    }

    case 'session_completed':
      if (state.status !== 'recording' || state.completedTrialCount !== state.queue.length) return state;
      return { ...state, status: 'complete' };

    case 'session_aborted':
      if (state.status !== 'recording') return state;
      return { ...state, status: 'aborted' };

    case 'reset':
      if (state.status === 'recording') return state;
      return initialStudyRunState;

    default:
      return state;
  }
}

export function getNextTimedPhase(phase: EegTrialPhase): EegTrialPhase | 'self_report' {
  switch (phase) {
    case 'baseline_rest':
      return 'pre_video_hint';
    case 'pre_video_hint':
      return 'video';
    case 'video':
      return 'post_video_rest';
    case 'post_video_rest':
      return 'self_report';
    default:
      return 'self_report';
  }
}

export function getStudyPhaseDurationSeconds(phase: StudyProtocolPhase) {
  if (phase === 'ready' || phase === 'quality_check') {
    return null;
  }

  return STUDY_PHASE_DURATIONS_SECONDS[phase];
}

export function getPhaseSecondsRemaining(
  phase: StudyProtocolPhase,
  phaseStartedAtMs: number | null,
  nowMs: number,
) {
  const duration = getStudyPhaseDurationSeconds(phase);
  if (duration === null || phaseStartedAtMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, nowMs - phaseStartedAtMs) / 1000;
  return Math.max(0, Math.ceil(duration - elapsedSeconds));
}

export function getSuggestedStudyQuality(
  emotion: BeginEegTrialInput['paradigmEmotion'],
  valence: number,
  arousal: number,
): StudyQuality {
  switch (emotion) {
    case 'depression':
      if (valence <= 4 && arousal <= 5) return 'accepted';
      if (valence === 5 || arousal === 6) return 'uncertain';
      return 'rejected';

    case 'anxiety':
      if (valence <= 4 && arousal >= 6) return 'accepted';
      if (valence === 5 || arousal === 5) return 'uncertain';
      return 'rejected';

    case 'calm':
      if (valence >= 5 && arousal <= 4) return 'accepted';
      if (valence < 5 || arousal === 5) return 'uncertain';
      return 'rejected';

    case 'happy':
      if (valence >= 6 && arousal >= 5 && arousal <= 8) return 'accepted';
      if (valence === 5 || arousal > 8) return 'uncertain';
      return 'rejected';

    default:
      return 'uncertain';
  }
}

export function shouldRevealStudyTarget(phase: StudyProtocolPhase) {
  return phase === 'quality_check';
}

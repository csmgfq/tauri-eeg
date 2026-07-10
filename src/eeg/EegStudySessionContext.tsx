import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  beginEegTrial,
  endEegTrial,
  finalizeEegTrial,
  markEegTrialPhase,
} from './eegApi';
import { chooseEegStudyVideoLibraryFolder } from './eegStudyVideoDirectoryPicker';
import { useEegSession } from './EegSessionContext';
import {
  STUDY_ARTIFACT_FLAGS,
  STUDY_TRIAL_COUNT,
  createStudySessionInput,
  createStudyTrialQueue,
  getNextTimedPhase,
  getPhaseSecondsRemaining,
  getStudyPhaseDurationSeconds,
  getSuggestedStudyQuality,
  initialStudyRunState,
  studyRunReducer,
  type StudyArtifactFlag,
  type StudyQuality,
} from './studySessionState';
import type {
  EegParadigmSession,
  EegStudyVideoLibrary,
  EegTrialEvent,
} from './types';

type StudySetup = {
  paradigmSession: EegParadigmSession;
  sessionRunId: string;
  subjectId: string;
};

type SelfReportDraft = {
  arousal: number;
  dominance: number | null;
  valence: number;
};

type QualityDraft = {
  acceptance: StudyQuality;
  artifactFlags: StudyArtifactFlag[];
  operatorNotes: string;
};

type StudySessionContextValue = {
  abortSession: () => Promise<void>;
  advanceTimedPhase: () => Promise<void>;
  beginTrial: () => Promise<void>;
  busy: boolean;
  chooseVideoLibrary: () => Promise<void>;
  completeSelfReport: () => void;
  currentTrial: ReturnType<typeof createStudyTrialQueue>[number] | null;
  errorMessage: string | null;
  finalizeTrial: () => Promise<void>;
  markVideoPlaybackFailure: () => void;
  navigationLocked: boolean;
  phaseSecondsRemaining: number | null;
  quality: QualityDraft;
  resetSession: () => void;
  run: typeof initialStudyRunState;
  selfReport: SelfReportDraft;
  setOperatorNotes: (value: string) => void;
  setQuality: (value: StudyQuality) => void;
  setSelfReport: (field: keyof SelfReportDraft, value: number | null) => void;
  setup: StudySetup;
  startSession: () => Promise<void>;
  toggleArtifactFlag: (flag: StudyArtifactFlag) => void;
  updateSetup: (field: keyof StudySetup, value: string) => void;
  videoLibrary: EegStudyVideoLibrary | null;
};

const initialSelfReport: SelfReportDraft = {
  arousal: 5,
  dominance: null,
  valence: 5,
};

const initialQuality: QualityDraft = {
  acceptance: 'uncertain',
  artifactFlags: [],
  operatorNotes: '',
};

function defaultRunId(session: EegParadigmSession) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  return `${session === 'personal_calibration' ? 'session-a' : 'session-b'}-${timestamp}`;
}

function errorText(error: unknown, fallback: string) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return fallback;
}

const EegStudySessionContext = createContext<StudySessionContextValue | null>(null);

export function EegStudySessionProvider({ children }: { children: ReactNode }) {
  const eeg = useEegSession();
  const [run, dispatch] = useReducer(studyRunReducer, initialStudyRunState);
  const [setup, setSetup] = useState<StudySetup>(() => ({
    paradigmSession: 'personal_calibration',
    sessionRunId: defaultRunId('personal_calibration'),
    subjectId: '',
  }));
  const [videoLibrary, setVideoLibrary] = useState<EegStudyVideoLibrary | null>(null);
  const [selfReport, setSelfReportState] = useState<SelfReportDraft>(initialSelfReport);
  const [quality, setQualityState] = useState<QualityDraft>(initialQuality);
  const [endEvent, setEndEvent] = useState<EegTrialEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const commandLockRef = useRef(false);
  const currentTrial = run.queue[run.currentTrialIndex] ?? null;
  const navigationLocked = run.status === 'recording';
  const phaseSecondsRemaining = getPhaseSecondsRemaining(run.phase, run.phaseStartedAtMs, nowMs);

  const runLockedCommand = useCallback(async (command: () => Promise<void>) => {
    if (commandLockRef.current) return;
    commandLockRef.current = true;
    setBusy(true);
    setErrorMessage(null);

    try {
      await command();
    } catch (error) {
      setErrorMessage(errorText(error, 'Study session command failed.'));
    } finally {
      commandLockRef.current = false;
      setBusy(false);
    }
  }, []);

  const advanceTimedPhase = useCallback(async () => {
    if (!currentTrial || !getStudyPhaseDurationSeconds(run.phase)) return;

    await runLockedCommand(async () => {
      if (run.phase === 'post_video_rest') {
        const event = await endEegTrial({ trialId: currentTrial.trialId });
        setEndEvent(event);
        dispatch({ type: 'eeg_ended', startedAtMs: Date.now() });
        return;
      }

      if (
        run.phase !== 'baseline_rest'
        && run.phase !== 'pre_video_hint'
        && run.phase !== 'video'
      ) {
        return;
      }

      const nextPhase = getNextTimedPhase(run.phase);
      if (nextPhase === 'self_report') return;
      await markEegTrialPhase({ trialId: currentTrial.trialId, phase: nextPhase });
      dispatch({ type: 'phase_advanced', phase: nextPhase, startedAtMs: Date.now() });
    });
  }, [currentTrial, run.phase, runLockedCommand]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (errorMessage || busy || run.phaseStartedAtMs === null) return undefined;
    const duration = getStudyPhaseDurationSeconds(run.phase);
    if (duration === null || run.phase === 'self_report') return undefined;

    const remainingMs = Math.max(0, run.phaseStartedAtMs + duration * 1000 - Date.now());
    const timeout = window.setTimeout(() => void advanceTimedPhase(), remainingMs);
    return () => window.clearTimeout(timeout);
  }, [advanceTimedPhase, busy, errorMessage, run.phase, run.phaseStartedAtMs]);

  useEffect(() => {
    if (!navigationLocked) return undefined;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [navigationLocked]);

  const chooseVideoLibrary = useCallback(async () => {
    await runLockedCommand(async () => {
      const library = await chooseEegStudyVideoLibraryFolder();
      if (library) setVideoLibrary(library);
    });
  }, [runLockedCommand]);

  const startSession = useCallback(async () => {
    if (!setup.subjectId.trim() || !setup.sessionRunId.trim()) {
      setErrorMessage('Subject id and session run id are required.');
      return;
    }
    if (!videoLibrary) {
      setErrorMessage('Select and validate the four-class study video root.');
      return;
    }
    if (eeg.deviceStatus !== 'streaming' || !eeg.triggerConnected) {
      setErrorMessage('EEG and trigger streams must both be connected.');
      return;
    }

    await runLockedCommand(async () => {
      const queue = createStudyTrialQueue(setup.sessionRunId.trim(), videoLibrary.assets);
      const started = await eeg.startRecord(createStudySessionInput(
        setup.paradigmSession,
        setup.subjectId,
        setup.sessionRunId,
      ));
      if (!started) throw new Error('EEG recorder did not start the study session.');
      dispatch({ type: 'session_started', queue });
    });
  }, [eeg, runLockedCommand, setup, videoLibrary]);

  const beginTrial = useCallback(async () => {
    if (!currentTrial || run.phase !== 'ready' || run.completedTrialCount >= STUDY_TRIAL_COUNT) return;
    await runLockedCommand(async () => {
      await beginEegTrial(currentTrial);
      setEndEvent(null);
      setSelfReportState(initialSelfReport);
      setQualityState(initialQuality);
      dispatch({ type: 'trial_started', startedAtMs: Date.now() });
    });
  }, [currentTrial, run.completedTrialCount, run.phase, runLockedCommand]);

  const completeSelfReport = useCallback(() => {
    if (!currentTrial || run.phase !== 'self_report') return;
    const artifactFlags = [...quality.artifactFlags];
    const missingTrigger = endEvent?.triggerStartSample == null || endEvent.triggerEndSample == null;
    const timedOut = run.phaseStartedAtMs !== null
      && Date.now() - run.phaseStartedAtMs >= 30_000;
    if (missingTrigger && !artifactFlags.includes('trigger_missing')) artifactFlags.push('trigger_missing');
    if (timedOut && !artifactFlags.includes('self_report_timeout')) artifactFlags.push('self_report_timeout');

    setQualityState({
      ...quality,
      acceptance: artifactFlags.length > 0
        ? 'artifact_rejected'
        : getSuggestedStudyQuality(
          currentTrial.paradigmEmotion,
          selfReport.valence,
          selfReport.arousal,
        ),
      artifactFlags,
    });
    dispatch({ type: 'quality_check_opened' });
  }, [currentTrial, endEvent, quality, run.phase, run.phaseStartedAtMs, selfReport]);

  const finalizeTrial = useCallback(async () => {
    if (!currentTrial || run.phase !== 'quality_check') return;
    await runLockedCommand(async () => {
      const acceptance = quality.artifactFlags.length > 0
        ? 'artifact_rejected'
        : quality.acceptance;
      const record = await finalizeEegTrial({
        artifactFlags: quality.artifactFlags,
        labelSource: 'self_report_confirmed',
        operatorNotes: quality.operatorNotes.trim() || null,
        selfReportAcceptance: acceptance,
        selfReportArousal: selfReport.arousal,
        selfReportDominance: selfReport.dominance,
        selfReportValence: selfReport.valence,
        trialId: currentTrial.trialId,
      });
      const isLastTrial = run.completedTrialCount + 1 === run.queue.length;
      dispatch({ type: 'trial_finalized', record });

      if (isLastTrial) {
        const stopped = await eeg.stopRecord();
        if (!stopped) throw new Error('All trials are finalized, but the session recorder did not stop.');
        dispatch({ type: 'session_completed' });
      }
    });
  }, [currentTrial, eeg, quality, run.completedTrialCount, run.phase, run.queue.length, runLockedCommand, selfReport]);

  const abortSession = useCallback(async () => {
    if (!navigationLocked) return;
    await runLockedCommand(async () => {
      const stopped = await eeg.stopRecord();
      if (!stopped) throw new Error('Failed to stop the active study recorder.');
      dispatch({ type: 'session_aborted' });
    });
  }, [eeg, navigationLocked, runLockedCommand]);

  const updateSetup = useCallback((field: keyof StudySetup, value: string) => {
    setSetup((current) => {
      if (field === 'paradigmSession') {
        const paradigmSession = value as EegParadigmSession;
        return {
          ...current,
          paradigmSession,
          sessionRunId: defaultRunId(paradigmSession),
        };
      }
      return { ...current, [field]: value };
    });
  }, []);

  const setSelfReport = useCallback((field: keyof SelfReportDraft, value: number | null) => {
    setSelfReportState((current) => ({ ...current, [field]: value }));
  }, []);

  const toggleArtifactFlag = useCallback((flag: StudyArtifactFlag) => {
    if (!STUDY_ARTIFACT_FLAGS.includes(flag)) return;
    setQualityState((current) => {
      const selected = current.artifactFlags.includes(flag);
      const artifactFlags = selected
        ? current.artifactFlags.filter((value) => value !== flag)
        : [...current.artifactFlags, flag];
      return {
        ...current,
        acceptance: artifactFlags.length > 0 ? 'artifact_rejected' : current.acceptance,
        artifactFlags,
      };
    });
  }, []);

  const value = useMemo<StudySessionContextValue>(() => ({
    abortSession,
    advanceTimedPhase,
    beginTrial,
    busy,
    chooseVideoLibrary,
    completeSelfReport,
    currentTrial,
    errorMessage,
    finalizeTrial,
    markVideoPlaybackFailure: () => {
      setQualityState((current) => current.artifactFlags.includes('video_playback_failure')
        ? current
        : { ...current, artifactFlags: [...current.artifactFlags, 'video_playback_failure'] });
    },
    navigationLocked,
    phaseSecondsRemaining,
    quality,
    resetSession: () => {
      if (!navigationLocked) {
        dispatch({ type: 'reset' });
        setErrorMessage(null);
      }
    },
    run,
    selfReport,
    setOperatorNotes: (operatorNotes) => setQualityState((current) => ({ ...current, operatorNotes })),
    setQuality: (acceptance) => setQualityState((current) => ({ ...current, acceptance })),
    setSelfReport,
    setup,
    startSession,
    toggleArtifactFlag,
    updateSetup,
    videoLibrary,
  }), [
    abortSession,
    advanceTimedPhase,
    beginTrial,
    busy,
    chooseVideoLibrary,
    completeSelfReport,
    currentTrial,
    errorMessage,
    finalizeTrial,
    navigationLocked,
    phaseSecondsRemaining,
    quality,
    run,
    selfReport,
    setSelfReport,
    setup,
    startSession,
    toggleArtifactFlag,
    updateSetup,
    videoLibrary,
  ]);

  return <EegStudySessionContext.Provider value={value}>{children}</EegStudySessionContext.Provider>;
}

export function useEegStudySession() {
  const value = useContext(EegStudySessionContext);
  if (!value) throw new Error('useEegStudySession must be used inside EegStudySessionProvider');
  return value;
}

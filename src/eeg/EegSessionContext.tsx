import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  useEffect,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { EegRingBuffer } from './eegRingBuffer';
import {
  getEegStatus,
  listenToEegSampleBlocks,
  startEegRecording,
  startEegStream,
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
import {
  DEFAULT_SAMPLE_RATE_HZ,
  createInitialEegDisplaySettings,
  toggleEegChannelVisibility,
} from './eegSessionStore';
import type {
  EegDisplaySettings,
  EegDisplaySnapshot,
  EegRecordingSession,
  EegStudySessionInput,
  EegStreamInfo,
} from './types';

type EegSessionContextValue = {
  activeStudySession: EegStudySessionInput | null;
  bufferRef: MutableRefObject<EegRingBuffer>;
  canPauseRecord: boolean;
  canResumeRecord: boolean;
  canStartDevice: boolean;
  canStartRecord: boolean;
  canStopDevice: boolean;
  canStopRecord: boolean;
  channels: typeof DEFAULT_EEG_CHANNELS;
  deviceStatus: typeof initialEegSessionState.deviceStatus;
  errorMessage: string | null;
  pauseRecord: () => void;
  recordStatus: typeof initialEegSessionState.recordStatus;
  resetBuffer: () => void;
  resumeRecord: () => void;
  sampleRateHz: number;
  triggerConnected: boolean;
  settings: EegDisplaySettings;
  setAmplitudeUvPerDiv: (amplitudeUvPerDiv: number) => void;
  setTimeWindowSeconds: (timeWindowSeconds: number) => void;
  startDevice: () => Promise<void>;
  startRecord: (studySession?: EegStudySessionInput) => Promise<boolean>;
  stopDevice: () => Promise<void>;
  stopRecord: () => Promise<EegRecordingSession | null>;
  takeSnapshot: () => EegDisplaySnapshot;
  toggleChannel: (channelId: string) => void;
};

const EegSessionContext = createContext<EegSessionContextValue | null>(null);

export function EegProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const channels = DEFAULT_EEG_CHANNELS;
  const bufferRef = useRef(new EegRingBuffer(channels, DEFAULT_SAMPLE_RATE_HZ));

  const [streamInfo, setStreamInfo] = useState<EegStreamInfo | null>(null);
  const [activeStudySession, setActiveStudySession] = useState<EegStudySessionInput | null>(null);
  const [triggerConnected, setTriggerConnected] = useState(false);
  const [sessionState, dispatchSession] = useReducer(eegSessionReducer, initialEegSessionState);
  const [settings, setSettings] = useState<EegDisplaySettings>(createInitialEegDisplaySettings);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToEegSampleBlocks((payload) => {
      bufferRef.current.appendPayload(payload);
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        dispatchSession({
          type: 'start_device_failed',
          message: typeof error === 'string' ? error : 'Failed to subscribe to EEG stream.',
        });
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const startDevice = useCallback(async () => {
    if (!canStartDevice(sessionState)) {
      return;
    }

    dispatchSession({ type: 'start_device_requested' });

    try {
      const info = await startEegStream();
      setStreamInfo(info);
      const status = await getEegStatus();
      setTriggerConnected(status.triggerConnected);
      if (status.eegConnected) {
        dispatchSession({ type: 'start_device_succeeded' });
      }
    } catch (error) {
      dispatchSession({
        type: 'start_device_failed',
        message: typeof error === 'string' ? error : 'Failed to start EEG stream.',
      });
    }
  }, [sessionState]);

  useEffect(() => {
    if (sessionState.deviceStatus !== 'starting') {
      return undefined;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      getEegStatus()
        .then((status) => {
          if (cancelled) {
            return;
          }
          if (status.eegConnected) {
            setTriggerConnected(status.triggerConnected);
            dispatchSession({ type: 'start_device_succeeded' });
          }
        })
        .catch(() => {
          // Keep the device start button available for another explicit attempt.
        });
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionState.deviceStatus]);

  useEffect(() => {
    if (sessionState.deviceStatus !== 'streaming') {
      return undefined;
    }

    let cancelled = false;
    const refreshConnections = () => {
      getEegStatus()
        .then((status) => {
          if (!cancelled) {
            setTriggerConnected(status.triggerConnected);
          }
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(refreshConnections, 1000);
    refreshConnections();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionState.deviceStatus]);

  const stopDevice = useCallback(async () => {
    if (activeStudySession || !canStopDevice(sessionState)) {
      return;
    }

    dispatchSession({ type: 'stop_device_requested' });

    try {
      await stopEegStream();
      setStreamInfo(null);
      setTriggerConnected(false);
      bufferRef.current.reset();
      dispatchSession({ type: 'stop_device_succeeded' });
    } catch (error) {
      dispatchSession({
        type: 'stop_device_failed',
        message: typeof error === 'string' ? error : 'Failed to stop EEG stream.',
      });
    }
  }, [activeStudySession, sessionState]);

  const startRecord = useCallback(async (studySession?: EegStudySessionInput) => {
    if (!canStartRecord(sessionState)) {
      return false;
    }

    if (!currentUser) {
      dispatchSession({
        type: 'start_record_failed',
        message: 'Sign in before recording EEG.',
      });
      return false;
    }

    try {
      await startEegRecording({
        userId: currentUser.id,
        username: currentUser.username,
        studySession,
      });
      setActiveStudySession(studySession ?? null);
      dispatchSession({ type: 'start_record' });
      return true;
    } catch (error) {
      dispatchSession({
        type: 'start_record_failed',
        message: typeof error === 'string' ? error : 'Failed to start EEG recording.',
      });
      return false;
    }
  }, [currentUser, sessionState]);

  const pauseRecord = useCallback(() => {
    if (!activeStudySession && canPauseRecord(sessionState)) {
      dispatchSession({ type: 'pause_record' });
    }
  }, [activeStudySession, sessionState]);

  const resumeRecord = useCallback(() => {
    if (!activeStudySession && canResumeRecord(sessionState)) {
      dispatchSession({ type: 'resume_record' });
    }
  }, [activeStudySession, sessionState]);

  const stopRecord = useCallback(async () => {
    if (!canStopRecord(sessionState)) {
      return null;
    }

    try {
      const session = await stopEegRecording();
      setActiveStudySession(null);
      dispatchSession({ type: 'stop_record' });
      return session;
    } catch (error) {
      dispatchSession({
        type: 'record_command_failed',
        message: typeof error === 'string' ? error : 'Failed to stop EEG recording.',
      });
      return null;
    }
  }, [sessionState]);

  const resetBuffer = useCallback(() => {
    bufferRef.current.reset();
  }, []);

  const setTimeWindowSeconds = useCallback((timeWindowSeconds: number) => {
    setSettings((current) => ({ ...current, timeWindowSeconds }));
  }, []);

  const setAmplitudeUvPerDiv = useCallback((amplitudeUvPerDiv: number) => {
    setSettings((current) => ({ ...current, amplitudeUvPerDiv }));
  }, []);

  const toggleChannel = useCallback((channelId: string) => {
    setSettings((current) => {
      const visibleChannelIds = toggleEegChannelVisibility(current.visibleChannelIds, channelId);

      return { ...current, visibleChannelIds };
    });
  }, []);

  const takeSnapshot = useCallback(() => (
    bufferRef.current.toDisplayData(
      settings.visibleChannelIds,
      settings.timeWindowSeconds,
    )
  ), [settings.timeWindowSeconds, settings.visibleChannelIds]);

  const value = useMemo<EegSessionContextValue>(() => ({
    activeStudySession,
    bufferRef,
    canPauseRecord: !activeStudySession && canPauseRecord(sessionState),
    canResumeRecord: !activeStudySession && canResumeRecord(sessionState),
    canStartDevice: canStartDevice(sessionState),
    canStartRecord: canStartRecord(sessionState),
    canStopDevice: !activeStudySession && canStopDevice(sessionState),
    canStopRecord: canStopRecord(sessionState),
    channels,
    deviceStatus: sessionState.deviceStatus,
    errorMessage: sessionState.errorMessage,
    pauseRecord,
    recordStatus: sessionState.recordStatus,
    resetBuffer,
    resumeRecord,
    sampleRateHz: streamInfo?.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ,
    triggerConnected,
    settings,
    setAmplitudeUvPerDiv,
    setTimeWindowSeconds,
    startDevice,
    startRecord,
    stopDevice,
    stopRecord,
    takeSnapshot,
    toggleChannel,
  }), [
    activeStudySession,
    channels,
    pauseRecord,
    resetBuffer,
    resumeRecord,
    sessionState,
    settings,
    setAmplitudeUvPerDiv,
    setTimeWindowSeconds,
    startDevice,
    startRecord,
    stopDevice,
    stopRecord,
    streamInfo?.sampleRateHz,
    takeSnapshot,
    toggleChannel,
    triggerConnected,
  ]);

  return (
    <EegSessionContext.Provider value={value}>
      {children}
    </EegSessionContext.Provider>
  );
}

export function useEegSession() {
  const value = useContext(EegSessionContext);

  if (!value) {
    throw new Error('useEegSession must be used inside EegProvider');
  }

  return value;
}

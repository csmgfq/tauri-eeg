import { open } from '@tauri-apps/plugin-dialog';
import { loadEegStudyVideoLibrary } from './eegApi';

export async function chooseEegStudyVideoLibraryFolder() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select EEG study video root',
  });

  if (typeof selected !== 'string') {
    return null;
  }

  return loadEegStudyVideoLibrary(selected);
}

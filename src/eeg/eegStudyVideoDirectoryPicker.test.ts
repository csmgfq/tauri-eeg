import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { loadEegStudyVideoLibrary } from './eegApi';
import { chooseEegStudyVideoLibraryFolder } from './eegStudyVideoDirectoryPicker';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('./eegApi', () => ({ loadEegStudyVideoLibrary: vi.fn() }));

describe('chooseEegStudyVideoLibraryFolder', () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
    vi.mocked(loadEegStudyVideoLibrary).mockReset();
  });

  it('validates the selected root through the study video API', async () => {
    const library = { assets: [], root: 'D:\\study' };
    vi.mocked(open).mockResolvedValueOnce('D:\\study');
    vi.mocked(loadEegStudyVideoLibrary).mockResolvedValueOnce(library);

    await expect(chooseEegStudyVideoLibraryFolder()).resolves.toBe(library);
    expect(loadEegStudyVideoLibrary).toHaveBeenCalledWith('D:\\study');
  });

  it('does not call the loader when selection is cancelled', async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    await expect(chooseEegStudyVideoLibraryFolder()).resolves.toBeNull();
    expect(loadEegStudyVideoLibrary).not.toHaveBeenCalled();
  });
});

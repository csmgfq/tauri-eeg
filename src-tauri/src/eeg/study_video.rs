use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

const MINIMUM_VIDEOS_PER_CLASS: usize = 5;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStudyVideoAsset {
    pub display_name: String,
    pub paradigm_emotion: String,
    pub system_emotion: String,
    pub trigger_class: u8,
    pub video_id: String,
    pub video_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStudyVideoLibrary {
    pub assets: Vec<EegStudyVideoAsset>,
    pub root: String,
}

struct EmotionFolder {
    display_name: &'static str,
    folder_name: &'static str,
    paradigm_emotion: &'static str,
    system_emotion: &'static str,
    trigger_class: u8,
}

const EMOTION_FOLDERS: [EmotionFolder; 4] = [
    EmotionFolder {
        display_name: "Depression",
        folder_name: "Depression",
        paradigm_emotion: "depression",
        system_emotion: "sad",
        trigger_class: 1,
    },
    EmotionFolder {
        display_name: "Anxiety",
        folder_name: "Anxiety",
        paradigm_emotion: "anxiety",
        system_emotion: "fear",
        trigger_class: 2,
    },
    EmotionFolder {
        display_name: "Calm",
        folder_name: "Calm",
        paradigm_emotion: "calm",
        system_emotion: "neutral",
        trigger_class: 3,
    },
    EmotionFolder {
        display_name: "Happy",
        folder_name: "Happy",
        paradigm_emotion: "happy",
        system_emotion: "happy",
        trigger_class: 4,
    },
];

pub fn load_eeg_study_video_library(folder_path: &str) -> Result<EegStudyVideoLibrary, String> {
    let root_text = folder_path.trim();
    if root_text.is_empty() {
        return Err("Study video root is required.".to_string());
    }

    let root = PathBuf::from(root_text);
    if !root.is_dir() {
        return Err("Study video root must be an existing directory.".to_string());
    }

    let mut assets = Vec::new();
    let mut video_ids = HashSet::new();

    for emotion in &EMOTION_FOLDERS {
        let folder = root.join(emotion.folder_name);
        if !folder.is_dir() {
            return Err(format!(
                "Study video root is missing the {} directory.",
                emotion.folder_name
            ));
        }

        let files = collect_mp4_files(&folder)?;
        if files.len() < MINIMUM_VIDEOS_PER_CLASS {
            return Err(format!(
                "{} requires at least {} MP4 videos; found {}.",
                emotion.folder_name,
                MINIMUM_VIDEOS_PER_CLASS,
                files.len()
            ));
        }

        for file in files {
            let stem = file
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "Study video filename is not valid UTF-8.".to_string())?;
            let video_id = format!("{}-{}", emotion.paradigm_emotion, stem);
            if !video_ids.insert(video_id.clone()) {
                return Err(format!("Duplicate study video id: {video_id}."));
            }

            assets.push(EegStudyVideoAsset {
                display_name: emotion.display_name.to_string(),
                paradigm_emotion: emotion.paradigm_emotion.to_string(),
                system_emotion: emotion.system_emotion.to_string(),
                trigger_class: emotion.trigger_class,
                video_id,
                video_path: file.to_string_lossy().to_string(),
            });
        }
    }

    Ok(EegStudyVideoLibrary {
        assets,
        root: root.to_string_lossy().to_string(),
    })
}

fn collect_mp4_files(folder: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files: Vec<PathBuf> = fs::read_dir(folder)
        .map_err(|_| "Failed to read a study video class directory.".to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.eq_ignore_ascii_case("mp4"))
                    .unwrap_or(false)
        })
        .collect();
    files.sort_by_key(|path| path.file_name().map(|value| value.to_os_string()));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::File,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_root() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("tauri-eeg-study-videos-{nonce}"))
    }

    #[test]
    fn validates_four_class_video_library() {
        let root = temp_root();
        for emotion in &EMOTION_FOLDERS {
            let folder = root.join(emotion.folder_name);
            fs::create_dir_all(&folder).unwrap();
            for index in 1..=5 {
                File::create(folder.join(format!("clip-{index:02}.mp4"))).unwrap();
            }
        }

        let library = load_eeg_study_video_library(root.to_str().unwrap()).unwrap();
        assert_eq!(library.assets.len(), 20);
        assert_eq!(
            library
                .assets
                .iter()
                .filter(|asset| asset.paradigm_emotion == "calm")
                .count(),
            5
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_incomplete_class_directories() {
        let root = temp_root();
        fs::create_dir_all(root.join("Depression")).unwrap();
        let error = load_eeg_study_video_library(root.to_str().unwrap()).unwrap_err();
        assert!(error.contains("Depression requires at least 5"));
        fs::remove_dir_all(root).unwrap();
    }
}

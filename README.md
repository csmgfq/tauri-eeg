# tauri-eeg

Desktop EEG and regulation workspace built with Tauri 2, React, TypeScript, Rust, and a local Python music generation service.

## Features

- Local multi-user login backed by SQLite.
- EEG acquisition workspace with realtime waveform display, channel controls, and animated page entry.
- Video, game, and music regulation pages.
- Music page with a compact player, layered prompt builder, generated WAV history, progress display, and file deletion.
- Local Stable Audio 3 Small Music generation through `music-service`.

## User Guide / 用户操作指南

正式的 Session A/B 脑电情绪范式位于应用的 `EEG Acquisition` 页面。完整的采集规范、自评规则、异常处理和数据字段说明见：

- [脑电驱动音乐生成与后续调控范式执行操作指南](docs/eeg-emotion-paradigm-operation-guide.zh.md)

### Study video library / 范式视频库

点击界面中的 `Study Videos` 时，应选择包含以下四个子目录的共同根目录，而不是某一个情绪目录：

```text
study-videos/
├── Depression/   # at least 5 MP4 files
├── Anxiety/      # at least 5 MP4 files
├── Calm/         # at least 5 MP4 files
└── Happy/        # at least 5 MP4 files
```

- 四个目录名称必须完全一致；为兼容 Windows、macOS 和 Linux，请保持上述大小写。
- 每类至少 5 个直接放在对应目录下的 `.mp4` 文件，总计至少 20 个；嵌套目录不会被扫描。
- 不需要额外的 JSON 索引。文件名会用于生成稳定的 `video_id`，正式采集后不要重命名。
- 当前 UI 每个 trial 固定播放视频 45 秒，因此视频应至少持续 45 秒，并提前检查可播放性和音量一致性。
- 每类多于 5 个视频时，系统会根据 `Session run ID` 确定性选择 5 个并生成可复现的 20-trial 队列。

### Session A/B quick start / 快速操作

1. 登录后进入 `EEG Acquisition`，点击 `Start Device`。
2. 等待界面同时显示 EEG `streaming` 和 Trigger `connected`。
3. 首次个人校准选择 `Session A · Calibration`；独立评估选择 `Session B · Held-out`。
4. 填写稳定的 `Subject ID` 和本次唯一的 `Session run ID`。
5. 点击 `Study Videos` 并选择符合上述结构的视频根目录。
6. 点击 `Start 20-Trial Session`。范式会自行启动连续录制，不要提前点击普通的 `Start Record`。
7. 每个 trial 点击 `Begin Trial`，系统自动执行 5 秒基线、2 秒提示、45 秒视频和 5 秒视频后静息。
8. 完成 1-9 分的 valence/arousal 自评、质量检查和伪迹标记，然后点击 `Finalize Trial`。
9. 第 20 个 trial 完成后录制自动停止。需要提前退出时使用 `End Session`，不要直接刷新或关闭窗口。

视频库校验通过并不代表可以开始正式采集；`Start 20-Trial Session` 还要求真实 EEG 数据流和 trigger 均已连接。

## Requirements

- Node.js and pnpm.
- Rust toolchain for Tauri.
- Tauri CLI through the project dependency: `pnpm tauri ...`.
- Python package manager `uv` for `music-service`.
- Hugging Face account with access accepted for `stabilityai/stable-audio-3-small-music`.
- NVIDIA CUDA is optional but recommended for music generation.

## Install

```powershell
cd D:\tauri-eeg
pnpm install
```

Set up the Python music service:

```powershell
cd D:\tauri-eeg\music-service
uv sync
```

For RTX 50-series / CUDA 12.8 systems, install the CUDA dependency extra:

```powershell
cd D:\tauri-eeg\music-service
uv sync --extra cu128
uv run python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

## Hugging Face Cache

The Stable Audio model is downloaded through Hugging Face. To keep the model cache in a stable location on Windows:

```powershell
[Environment]::SetEnvironmentVariable("HF_HOME", "D:\.hf-cache", "User")
```

Close and reopen PowerShell, your IDE, and the Tauri app after changing the user environment. For the current terminal session only:

```powershell
$env:HF_HOME="D:\.hf-cache"
```

Verify login:

```powershell
cd D:\tauri-eeg\music-service
uv run hf auth whoami
```

If needed:

```powershell
uv run huggingface-cli login
```

## Run The App

Development frontend only:

```powershell
cd D:\tauri-eeg
pnpm dev
```

Tauri desktop app:

```powershell
cd D:\tauri-eeg
pnpm tauri dev
```

## Music Generation Flow

The Music page tries to start `music-service` automatically when generating a track. On first use, the model download and load can take longer than the app startup wait. If the app reports:

```text
Music generation service did not become ready.
```

start the service manually once:

```powershell
cd D:\tauri-eeg\music-service
$env:HF_HOME="D:\.hf-cache"
uv run python server.py
```

Keep that terminal open. In another terminal, check readiness:

```powershell
curl http://127.0.0.1:8000/health
```

When the health response is ready, generate again from the Music page. The app reuses the running service at `http://127.0.0.1:8000`.

Notes:

- `flash_attn` warnings are expected when Flash Attention is not installed; the service falls back without it.
- `on_event is deprecated` is a FastAPI deprecation warning and does not block generation.
- `WinError 10048` means another service is already using port `8000`; stop the old process or reuse it.
- RTX 5090 / RTX 50-series GPUs need CUDA wheels that support `sm_120`, so use the `cu128` extra.

## Data Locations

Current Windows paths:

```text
User database:
C:\Users\<you>\AppData\Local\tauri-eeg\users.sqlite3

Generated music WAV files:
C:\Users\<you>\AppData\Roaming\com.tauri-eeg.app\music

Hugging Face model cache, if configured:
D:\.hf-cache\hub
```

Generated WAV history can be opened from the Music Player history button. Deleting a generated history item from the app also deletes its WAV file, limited to the app music output directory.

## Verification

Frontend build:

```powershell
pnpm build
```

Frontend tests:

```powershell
pnpm test
```

Rust formatting and tests:

```powershell
cd D:\tauri-eeg\src-tauri
cargo fmt --check
cargo test
```

Python music-service tests:

```powershell
cd D:\tauri-eeg\music-service
uv run pytest
```

## Project Structure

```text
src/                 React UI, auth, EEG, and music client code
src-tauri/           Tauri/Rust backend commands, SQLite, file handling
music-service/       FastAPI Stable Audio generation service
docs/superpowers/    Design specs and implementation plans
```

# 脑电驱动音乐生成与后续调控范式执行操作指南

本文档是 32 通道脑电情绪校准范式的执行手册，面向实际采集人员和系统集成人员。当前研究目标是采集可用于个人情绪识别和 EEG-conditioned 音乐生成的高质量数据；音乐对 EEG/主观情绪的闭环调控属于后续研究，不进入当前论文的完成标准。

## 1. 核心原则

本系统采用 SEED-style 离散情绪诱发范式，不采用 DEAP-style 事后四象限硬切方式。

执行原则：

- 先用明确类别的视频诱发目标情绪。
- 每个 trial 后采集被试自评。
- 用自评确认样本是否进入训练集。
- 模糊样本保留但不进入第一版监督分类器。
- 每个用户单独校准，不默认跨用户泛化。
- 当前论文的校准和 held-out generation session 均关闭音乐/视频反馈。
- 当前论文评价“生成音乐是否匹配 EEG 状态”，不评价“音乐是否改善或改变 EEG 状态”。

不要把所有 trial 按 `valence=5`、`arousal=5` 强行切成四类。DEAP 实验显示这会引入大量边界噪声。

## 2. 情绪类别

正式范式只保留 4 类：

```text
Depression -> sad
Anxiety    -> fear
Calm       -> neutral
Happy      -> happy
```

触发码：

```text
1 Depression
2 Anxiety
3 Calm
4 Happy
```

`Fear`、`Joy`、`Surprise` 不作为第一版正式训练类别。它们可以保留在候选素材池中，但不要进入最小系统模块的分类标签。

## 3. 视频素材准备

目录结构：

```text
database/Depression
database/Anxiety
database/Calm
database/Happy
```

最小可运行数量：

```text
每类 5 个视频
总计 20 个视频 trial / session
```

视频要求：

- 时长建议 45-90 秒。
- 每个视频只服务一个主要情绪目标。
- 避免同一视频同时强烈诱发多个目标情绪。
- 避免闪烁、强噪声、突然惊吓、过强负性内容。
- 每个视频需要稳定 `video_id`，不要只依赖文件名临时记录。

建议每类多准备 2-5 个备用视频，用于替换自评不稳定或容易混淆的素材。

## 4. 单个 Trial 流程

每个 trial 按以下顺序执行：

```text
baseline rest 5 s
-> starting hint 2 s
-> video watching 45-90 s
-> post-video rest 5 s
-> self-report <= 30 s
-> quality check
```

执行细节：

- `baseline rest`：黑屏或固定十字，要求被试放松、减少眨眼和头动。
- `starting hint`：提示即将观看视频，不显示目标情绪名称，避免暗示过强。
- `video watching`：播放视频并写入 trigger start/end 时间。
- `post-video rest`：视频结束后短暂静息，减少操作动作污染。
- `self-report`：采集 valence、arousal，dominance 可选。
- `quality check`：记录自评是否匹配目标情绪、是否有明显伪迹。

## 5. 自评量表

使用 1-9 分：

```text
valence: 1 非常负性, 5 中性, 9 非常正性
arousal: 1 非常平静/低唤醒, 5 中等, 9 非常激动/高唤醒
dominance: 可选
```

系统必须保存原始自评分数，不要只保存最终类别。

## 6. 样本接纳规则

只有 `accepted` 样本进入第一版监督训练。

接纳规则：

```text
Depression / sad:
  valence <= 4
  arousal <= 5

Anxiety / fear:
  valence <= 4
  arousal >= 6

Calm / neutral:
  valence >= 5
  arousal <= 4

Happy:
  valence >= 6
  5 <= arousal <= 8
```

质量标签：

```text
accepted
  自评与目标情绪一致，可进入训练集。

uncertain
  自评接近边界或情绪混合，保留数据但不进入第一版训练。

rejected
  自评明显不匹配目标情绪，排查视频素材。

artifact_rejected
  EEG 伪迹严重、触发时间缺失、通道异常或采集失败。
```

如果某一类 accepted trial 少于 3 个，本 session 不建议训练该类模型；应补采或替换视频。

## 7. Session 安排

Session A：个人校准 `personal_calibration`。

```text
目标：采集带自评确认的个人 EEG 标签数据。
反馈：关闭音乐/视频反馈。
输出：可训练的个人校准数据集。
```

Session B：独立生成评价 `held_out_generation`。

```text
目标：在独立 session 上验证个人模型，并评价 EEG-conditioned 音乐的情绪一致性、质量、实时性和稳定性。
反馈：关闭音乐/视频反馈；生成音频不作为下一 EEG 窗口的调控目标。
输出：held-out EEG 指标、生成音频、控制轨迹和系统性能记录。
```

Future Session C：闭环调控 `regulation_feedback`。

```text
目标：在当前 EEG-to-music 论文完成后，验证音乐/视频反馈是否改变 EEG 和主观情绪。
反馈：开启实时音乐调控，可接视频推荐。
输出：闭环、匹配开环、随机条件的状态变化和因果分析。
```

Session A 和 Session B 不要混为同一个训练/评估集。Future Session C 不得提前并入当前论文数据。

### 7.1 系统录制生命周期

每个 Session A/B 使用一段连续原始 EEG recording；20 个 trial 通过 Rust 侧样本索引切分：

```text
start_eeg_recording(studySession)
-> begin_eeg_trial
-> mark: pre_video_hint
-> mark: video
-> mark: post_video_rest
-> end_eeg_trial
-> participant self-report
-> finalize_eeg_trial
```

- `begin_eeg_trial` 记录 EEG 起始 sample index 和 Rust UTC。
- `end_eeg_trial` 必须在 post-video rest 结束后立即调用，冻结 EEG 终点。
- `finalize_eeg_trial` 只补自评和质量标签，不延长该 trial 的 EEG 范围。
- trigger 类别和 255 结束标记从原始 trigger 流关联到具体 sample index。
- 若 trigger 缺失，trial 只能标为 `artifact_rejected`，不能进入训练。
- 未完成便停止 recording 的 trial 自动写为 `interrupted`，保留审计记录。

Session 目录必须包含 `eeg.f32le.bin`、`trigger.i32le.bin`、`metadata.json`、`trial-events.jsonl` 和 `trials.jsonl`。

### 7.2 正式 UI 操作流程

正式范式位于应用的 `EEG Acquisition` 页面，先于 Video/Game/Music Regulation：

1. 启动 EEG device，确认 EEG 和 trigger 均显示 connected。
2. 选择 Session A `personal_calibration` 或 Session B `held_out_generation`。
3. 填写稳定的 `subject_id` 和本次唯一的 `session_run_id`。
4. 选择包含 `Depression/Anxiety/Calm/Happy` 四个子目录的视频根目录；每类至少需要 5 个 MP4。
5. 启动 session。系统按 `session_run_id` 确定性选择并打乱每类 5 个、总计 20 个 trial，同一 run id 可复现相同队列。
6. 每个 trial 依次执行 baseline、hint、video 和 post-rest；`end_eeg_trial` 成功后才显示自评。
7. 自评后进入质量检查。缺 trigger、视频播放失败、EEG gap、通道掉线或明显体动时必须标为 `artifact_rejected` 并保留具体 flag。
8. 第 20 个 trial finalize 后自动停止连续 recording；提前结束 session 时，活动 trial 以 `interrupted` 落盘。

Session 运行期间，普通 Pause、Stop Device、调控页导航、存储设置和退出登录均被锁定。不要用浏览器刷新或关闭窗口代替 `End Session`。

## 8. 必须保存的数据字段

每个 trial 至少保存：

```text
subject_id
session_id
trial_id
phase
paradigm_emotion
system_emotion
trigger_class
video_id
video_path
trigger_start_ts
trigger_end_ts
eeg_start_ts
eeg_end_ts
sample_rate_hz
channel_ids
recording_path
self_report_valence
self_report_arousal
self_report_dominance
self_report_acceptance
label_source
artifact_flags
device_metadata
operator_notes
```

`label_source` 建议取值：

```text
induction_target
self_report_confirmed
model_prediction
```

训练集优先使用：

```text
label_source = self_report_confirmed
self_report_acceptance = accepted
```

## 9. 采集前检查清单

采集开始前确认：

- 32 通道 EEG 已连接，阻抗/信号质量可接受。
- 实际采样率已记录，通常为 1000 Hz。
- 50 ms block 流正常进入系统后端。
- 所有视频文件可播放，音量一致。
- trigger start/end 能写入日志。
- 系统时间戳稳定。
- 被试知情同意和退出机制已完成。
- 被试了解自评量表，但不知道每个视频的目标标签。

## 10. 采集中异常处理

出现以下情况应标记 `artifact_rejected`：

- EEG 数据缺失。
- trigger start/end 缺失。
- 大量通道掉线。
- 明显体动、说话、摘帽、操作中断。
- 视频播放失败或卡顿。

出现以下情况应标记 `uncertain`：

- 自评正好落在边界附近。
- 被试反馈同时有多种情绪。
- 视频目标情绪和自评部分一致但不够明确。

出现以下情况应标记 `rejected`：

- Depression 视频被评为高正性。
- Anxiety 视频被评为低唤醒平静。
- Calm 视频引发高唤醒或明显负性。
- Happy 视频引发负性或过高唤醒不适。

## 11. 训练前数据检查

训练前统计：

```text
每类 accepted trial 数量
每类 uncertain trial 数量
每类 rejected trial 数量
每类 artifact_rejected trial 数量
每个 trial 的通道完整性
每个 trial 的有效 EEG 时长
valence/arousal 分布
```

最低训练条件：

```text
每类 accepted >= 3 个 trial: 可以做最小系统验证
每类 accepted >= 5 个 trial: 符合当前最小范式
每类 accepted >= 10 个 trial: 更适合做稳定模型选择
```

如果某类 accepted 数量不足，优先补采该类，不要用 uncertain 样本凑数。

## 12. 推荐模型训练路线

每个用户都应比较多条路线：

```text
direct four-class classifier
valence binary + arousal binary classifier
valence/arousal regression with rule mapping
Riemannian tangent-space SVM/LDA baseline
```

选择标准：

```text
validation balanced accuracy
per-class confusion matrix
低置信度比例
跨 session 稳定性
```

如果 direct four-class 表现差，但 valence/arousal 二分类稳定，可以先上线维度模型，再映射到当前音乐生成条件。

## 13. 实时系统接入要求

模型输出必须包含：

```text
emotion
probabilities
valence
arousal
confidence
source
updated_at
```

低置信度处理：

```text
confidence 高: 允许音乐参数逐步调整
confidence 中: 小幅平滑调整
confidence 低: 保持当前音乐状态或回到 neutral/calm 策略
```

不要让单个 EEG 窗口直接触发大幅音乐变化。至少应对多个窗口做平滑。

## 14. 当前音乐生成条件与未来调控策略

### 14.1 当前论文：状态一致性音乐生成

当前论文要求生成音乐与 EEG 解码出的情绪状态一致，不尝试把被试推向相反状态。

检测为 `sad / depression`：

```text
目标：匹配低 valence、低至中 arousal
音乐条件：较暗音色、较慢至中速、低到中能量、连续结构
```

检测为 `fear / anxiety`：

```text
目标：匹配低 valence、高 arousal
音乐条件：紧张感、更高密度和能量、较强节奏或不协和度
```

检测为 `neutral / calm`：

```text
目标：匹配中性至正 valence、低 arousal
音乐条件：环境感、轻质感、低动态、低新奇度
```

检测为 `happy`：

```text
目标：匹配正 valence、中等 arousal
音乐条件：明亮、旋律连续、中等能量、平滑变化
```

当前论文比较 true EEG、oracle label、shuffled EEG 和 static/no-EEG 条件，评价情绪一致性、音质、多样性和实时性。

### 14.2 后续研究：反向情绪调控

以下策略仅在 Future Session C 使用：

```text
sad / depression: 提升 valence，轻微提升 arousal
fear / anxiety:   降低 arousal，稳定 valence
neutral / calm:   维持低唤醒稳定状态
happy:            保持正性，避免过度刺激
```

## 15. 采集完成后的交付物

每个被试至少交付：

```text
raw EEG recordings
trial metadata json/csv
self-report table
artifact/quality table
accepted training manifest
uncertain/rejected audit manifest
model training report
validation confusion matrix
generated audio and condition manifest if Session B was run
latency report if Session B was run
closed-loop effect report only if Future Session C was run
```

这些文件应能回答三个问题：

```text
这个 trial 诱发了什么？
被试实际报告了什么？
这段 EEG 是否应该进入训练？
```

只有这三个问题都可追溯，当前 EEG 驱动音乐生成和后续闭环研究才有可靠基础。

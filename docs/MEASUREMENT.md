# Measurement and score rules

All signal processing runs in a browser AudioWorklet. Audio samples do not leave the browser. The worklet reports scalar readings at 100 ms intervals; the control room supplies spectrum bins. Node distributes snapshots to the controller and OBS overlay four times per second and owns the round clock and vote identities.

## Loudness

Each channel passes through a high shelf and RLB high pass, using sample-rate-adapted K-weighting coefficients. At 48 kHz these reproduce the coefficients in [ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/). The coefficient parameterization follows the De Man formulation described in the [pyloudnorm filter implementation](https://github.com/csteinmetz1/pyloudnorm/blob/master/pyloudnorm/iirfilter.py); the JavaScript measurement engine is implemented in this project.

For stereo weighted channel energies `zL` and `zR`:

```text
L = −0.691 + 10 log10(zL + zR)
```

The worklet accumulates 100 ms slices. Four adjacent slices form each 400 ms gating block, with 75% overlap. Blocks below −70 LUFS are discarded. Calculate the mean remaining energy, discard blocks more than 10 LU below that mean, then convert the final energy mean to LUFS. Integrated loudness uses all accepted blocks since measurement reset.

Short-term loudness uses the last 30 slices (3 seconds), without gating. It remains unavailable during warmup. Momentary loudness uses four slices (400 ms). Silence reports a missing value, rendered as a dash, rather than a fabricated reading.

Both channels have weight 1. Mono sources are duplicated to stereo by the audio graph. This version supports stereo, not multichannel programme layouts. Browser/device input processing can affect captured signals even though unprocessed capture is requested.

## True peak

The peak estimator reconstructs three intermediate samples per original sample with a 32-tap-per-phase normalized Blackman-windowed sinc filter. The original sample peak is included. History persists across audio blocks. Maximum absolute reconstructed amplitude becomes `20 log10(peak)` dBTP, with a programme hold reset at the beginning of a check.

This is a 4× estimate and has finite interpolation error, particularly near Nyquist. It has not been certified against every EBU compliance fixture. It should not replace a validated final-delivery meter. Tests explicitly verify a 12 kHz, quarter-cycle-shifted sine at 48 kHz whose sample peaks miss a roughly 3 dB intersample overshoot.

## Stereo and dynamics

For the last 3 seconds, let `LL = mean(L²)`, `RR = mean(R²)`, and `LR = mean(LR)`:

```text
correlation = LR / sqrt(LL × RR), clamped to [−1, 1]
midEnergy  = (LL + RR + 2LR) / 4
sideEnergy = (LL + RR − 2LR) / 4
width      = 100 sqrt(sideEnergy / (midEnergy + sideEnergy))
crest      = 20 log10(peakInWindow / sqrt((LL + RR) / 2))
```

`balance = 10 log10(LL / RR)` is the short-term left/right level gap in dB, clamped to ±60. The check samples it every 100 ms.

Identical channels yield width 0 and correlation +1. Uncorrelated equal-power channels yield about 70.7% width. Opposing equal-power channels yield width 100 and correlation −1. A silent channel makes correlation unavailable. Negative correlation is a prompt to listen in mono, not proof of a musical fault. The frequency graphic is an FFT visualization of the channel sum, not part of loudness or scoring.

## Score

No result is issued unless at least 28 seconds of worklet audio arrived during the 30-second wall-clock window, integrated loudness is above −60 LUFS, and a peak reading exists. Gaps longer than 2.5 seconds cancel audio capture and an unfinished check. This tolerates a small scheduling difference while avoiding a score from stale or insufficient audio.

Start at 100. Deductions are independent except that full-scale samples and excess true peak share one headroom deduction:

| Condition | Deduction |
| --- | --- |
| Any measured channel samples with `abs(sample) ≥ 1` | `35` (full-scale/clipping finding) |
| Otherwise, peak `p > −1 dBTP` | `min(35, 15 + 10 × (p + 1))` |
| Integrated `L` outside `−14 ±2 LU` | `min(25, 5 × (abs(L + 14) − 2))` |
| Correlation `c < 0` | `min(25, 10 + 15 × abs(c))` |
| Crest `d < 6 dB` | `min(15, 3 × (6 − d))` |
| Short-term L/R gap `abs(g) > 3 dB` for one continuous stretch longer than 3 s | `min(25, 15 + (X − 3))`, X = mean `abs(g)` over the longest such stretch |

Round `100 − sum(deductions)` to the nearest integer, clamp to 0–100, and rank findings by deduction, except that a stereo balance finding always comes first (“Stereo balance off: left/right differ by X dB”). The first finding supplies the headline and suggested fix. Scores ≥85 are “In good shape”; ≥65 are “A little more care”; lower scores are “Room to refine”. When every metric is in range, the suggestion is a matched-loudness reference comparison and a mono check.

The −14 LUFS target is a selectable project preference in code, not a requirement of BS.1770 or a universal mastering target. Width and the diagnostic low-frequency energy ratio do not deduct points. The latter is deliberately not used to infer weak bass. The result represents this excerpt and these measured properties; it does not assess a whole song or predict listener response.

## Playback presets

Original passes decoded samples through unchanged. Hot master applies `clamp(sample × 10^(6/20), −1, +1)` to both channels in the AudioWorklet before metering and monitoring. It never edits the AudioBuffer or source file. Switching presets resets the measurement epoch, rejects readings queued from the old epoch, and clears the old result and vote. A check locks the preset for its full measurement window.

The worklet reports the fraction of channel samples reaching full scale since reset. This is direct evidence of the Hot master's clipping operation; for imported material it is a full-scale warning, not proof of how the original was mastered. True-peak overshoots without full-scale samples still receive the ordinary peak finding. Quiet audio that remains below full scale after +6 dB receives no clipping finding. The Hot master clipping fix identifies the reversible preset first, then recommends reducing gain before limiting; lowering an already clipped file cannot recover its lost peaks.

## Numeric verification

The test suite covers published 48 kHz filter coefficients; 1 kHz sine calibration at 44.1, 48, and 96 kHz; absolute and relative gates; silence; warmup/reset; mono and opposite-polarity stereo; intersample peaks; and scoring boundaries. When FFmpeg is available, independently generated multitone fixtures must agree with its `ebur128` result within 0.2 LU integrated and 0.4 dB peak at both 44.1 and 48 kHz. This verifies the tested fixtures, not an exhaustive standards-compliance claim.

Run `npm test`. To compare your own track, use an unprocessed local file and a reference meter on the same channel layout and measurement window. An OBS capture can contain gain, resampling, mono conversion, or effects absent from the original file.

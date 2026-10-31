# Recording the demo

Use a 1920 × 1080 display or capture area with browser zoom at 100%. Run `npm run dev` in this project and open `http://127.0.0.1:5173`. Demo mode needs no Twitch credentials.

1. Click **Open audio file** and choose a clean stereo track. Playback starts with sound on. Keep **Original** selected and wait about three seconds for the short-term meter. The status reads **Analyzing local track**; the chat status reads **Demo chat**.
2. Send **`!check`** in Chat (or click its command chip). Keep playback running for the full **30 seconds**. The score out of 100 and top issue appear directly below the track bar. For a good baseline, use a track around −14 LUFS integrated, with true peaks at or below −1 dBTP, nonnegative stereo correlation and at least 6 dB crest factor.
3. Click **Hot master +6 dB**. This adds gain and hard clipping to the same playback inside the browser. The source file stays unchanged. The previous result and vote clear. Wait about three seconds for the new meter window.
4. Send **`!check`** again and keep playback running for **30 seconds**. A suitable baseline whose peaks exceed −6 dBFS will now clip, producing a lower score and the top issue **Clipping: samples reached full scale**. Scores reflect your audio; a very quiet file will not necessarily clip. The generated **Balanced mix** is also a repeatable baseline for the demonstration.
5. Send **`!fix`** as soon as the new score appears. The suggestion starts with **Switch back to Original**, then explains reducing gain before the output stage and using a −1 dBTP limiter ceiling. This reveals advice; it does not modify or repair the file.
6. During the **20-second** vote window, send **`!notyet`** or **`!ready`**. The labeled simulated audience casts votes too. The vote bar updates, and the final heading reads **Chat result: ready** or **Chat result: not yet**. Audience votes do not affect the measured score.

Click **Original** to remove the added processing. **Play/Pause** retains the track and its position. The speaker control mutes sound while measurement continues; pausing during a check cancels that check.

For the broadcast view, click **Open OBS overlay** or add `http://127.0.0.1:5173/overlay` as a 1920 × 1080 OBS Browser Source. Its page background is transparent. The card shows the same score, top issue, vote bar and revealed fix. Keep the control-room tab open; the overlay displays the session and does not play audio.

After restarting the computer, run `npm run dev` again and reload the page. Session history is kept in memory and clears when the server restarts. Local tracks must be selected again.

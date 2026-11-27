# Chat module

Updated 2026-11-27

## Setup

Keep Beeper Desktop running on the bridge PC. In **Beeper Settings → Developers**, create an access token for Orca Glass and save the token as plain text in `.local/beeper-token.txt` in the bridge checkout. Use a dedicated token. Beeper Remote Access can stay off because the bridge connects to `http://127.0.0.1:23373`. [Beeper Desktop API](https://developers.beeper.com/desktop-api/)

Add these keys to the bridge checkout's gitignored `bridge/config.local.json`. If `privateHosts` already exists for Email, keep its allowed Tailscale Serve hostname.

```json
{
  "beeper": {
    "tokenFile": ".local/beeper-token.txt",
    "refreshSeconds": 120,
    "asrLanguage": "yue",
    "asrScript": "s2hk",
    "translationModel": "qwen3.8:27b"
  },
  "privateHosts": ["<Tailscale Serve hostname>"]
}
```

An empty `beeper` object uses the defaults above. Keep the token file under the gitignored `.local/` directory and restrict access using its file permissions. The bridge reads the config at startup and loads the token from the file when calling Beeper.

### Local speech and translation

Received audio uses FunASR SenseVoiceSmall on CUDA with a separate FSMN-VAD pass. VAD limits sections to 15 seconds. An isolated Python process loads both models on the first transcription and stops after two minutes of inactivity. The English Whisper setup in `scripts/setup-voice.ps1` still serves dictated replies.

- Set `beeper.asrPython` to the interpreter in an existing FunASR venv. For a venv in `.local/voice/venv`, the bridge resolves the interpreter automatically. Otherwise it tries `python` on PATH.
- Install FFmpeg using `winget install --id Gyan.FFmpeg --exact`. The bridge tries PATH first. Set `beeper.ffmpegPath` to the installed executable when the bridge's service environment cannot find it on PATH.
- Use `asrLanguage: "yue"` for Cantonese, `"zh"` for Mandarin, or `"auto"` for mixed languages. SenseVoiceSmall supports Cantonese, Mandarin, English, Japanese and Korean. `asrScript: "s2hk"` applies OpenCC Hong Kong Traditional conversion to Chinese segments. Set it to `"none"` to display SenseVoice's native script. A Beeper-supplied transcript is shown as received. [SenseVoiceSmall](https://github.com/QwenAudio/SenseVoice)
- Keep Ollama running on `127.0.0.1:11434`. `ollama list` shows downloaded models. Set `beeper.translationModel` to a locally installed model if you use a different model from the default. The bridge checks model metadata before sending it text and declines cloud models.

#### Independent Windows venv

The verified configuration used Python 3.12 and CUDA 12.8 wheels on the RTX 5090. Install packages and provision models before enabling transcription.

```powershell
python -m venv .local/voice/venv
$chatPython = '.local/voice/venv/Scripts/python.exe'
& $chatPython -m pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128
& $chatPython -m pip install funasr==1.4.15 modelscope==1.40.1 opencc-python-reimplemented==0.1.7 soundfile==0.14.0
& $chatPython -c "import torch; assert torch.cuda.is_available()"
```

Copy the model directories from an existing ModelScope cache, or download them into `.local/voice/models` before starting the bridge.

```powershell
$modelScope = '.local/voice/venv/Scripts/modelscope.exe'
$senseVoice = '.local/voice/models/iic--SenseVoiceSmall'
$voiceActivity = '.local/voice/models/iic--speech_fsmn_vad_zh-cn-16k-common-pytorch'
& $modelScope download --model iic/SenseVoiceSmall --local_dir $senseVoice
& $modelScope download --model iic/speech_fsmn_vad_zh-cn-16k-common-pytorch --local_dir $voiceActivity
if ((Get-FileHash "$senseVoice/model.pt").Hash -ne '833CA2DCFDF8EC91BD4F31CFAC36D6124E0C459074D5E909AEC9CABE6204A3EA') { throw 'SenseVoice checksum mismatch' }
if ((Get-FileHash "$voiceActivity/model.pt").Hash -ne 'B3BE75BE477F0780277F3BAE0FE489F48718F585F3A6E45D7DD1FBB1A4255FC5') { throw 'FSMN-VAD checksum mismatch' }
```

The verified weights are 936,291,369 bytes for SenseVoice and 1,721,366 bytes for FSMN-VAD. The worker uses the configured `beeper.asrModelDir` and `beeper.asrVadDir` when set. Otherwise it checks the directories above, then the ModelScope `models/<model>/snapshots/master` cache under `MODELSCOPE_CACHE` or `~/.cache/modelscope`. It loads from disk without looking up a model on the network. [SenseVoice weights](https://modelscope.cn/models/iic/SenseVoiceSmall) · [FSMN-VAD weights](https://modelscope.cn/models/iic/speech_fsmn_vad_zh-cn-16k-common-pytorch)

## Use

Click row 0 to cycle through the offered modules or select **Chat** on the phone. The first row below it opens **Filter by Network**. Network checkboxes on the phone and the glasses share the same saved selection. The glasses show up to eight chats per page in activity order, with `/` for unread and `-` for read. The count covers the selected networks.

The reader starts at the beginning of the newest message. Swipe up for earlier pages and swipe down on the last page to refresh. Your messages begin with `/ ` and incoming messages begin with `> ` and the sender name. Opening an unread chat marks the whole chat read in Beeper once it is on screen (`POST /v1/chats/{chatID}/read`, empty body; Eugene, 2026-11-27). Beeper may send a read receipt to the other person where the network supports it. A failure shows `not marked read` in the status row and the chat stays unread. HTML line breaks in Beeper's text (`<br>`) show as line breaks.

Media uses `[Voice 0:12]`, `[Audio 0:12]`, `[Photo]`, `[Video]`, `[Sticker]`, `[File]` or `[Location]`. Duration appears when Beeper supplies it. Captions follow the tag.

Click once to transcribe voice and audio messages visible on that page that lack transcripts. `[Voice 0:12 · transcribing…]` becomes `[Voice 0:12] transcript`. `[Voice 0:12 · not transcribed]` can be retried with another click. The reader keeps its page number and rewraps the text, so additional pages can appear and later messages can move to a later page. Double-click goes back.

Use **Translate: Off** / **Translate: English** in the reader menu or the **Translate: English** checkbox in the phone's Chat section. It defaults to Off and the app saves the setting across restarts. When enabled, Chat shows the original immediately and adds its English translation in parentheses as it becomes available. English stays as-is. Received audio first appears in the recognized language, then gains the English translation.

Hold to dictate using local Whisper. Release to review the text, click to send, or double-click to cancel. The reader shows `sent` when Beeper accepts the submission and assigns a pending message ID. It shows `not sent` when the app receives no success response. A disconnect can hide an accepted send, so refresh the chat to check before submitting again. Neither the app nor the bridge automatically replays a send. [Beeper send response](https://developers.beeper.com/desktop-api-reference/resources/messages/methods/send/)

## Bridge routes

| Request | Response |
| --- | --- |
| `GET /api/capabilities` | Adds `chat` to `modules` when the Beeper block is configured. |
| `GET /api/chat/networks` | Sorted network names from Beeper accounts. |
| `GET /api/chat/list?networks=&page=0` | `{ items, unread, hasMore }` with eight chats per page. Pass comma-separated network names or leave the filter empty for all networks. |
| `GET /api/chat/messages?id=<chat-id>` | `{ messages }` with the latest Beeper message batch in chronological order. |
| `POST /api/chat/transcribe` with `{ chatId, messageId }` | `{ text, language }`. The language is the SenseVoice language tag, `mul` for mixed tags, or `und` when auto produces no recognized tag. |
| `POST /api/chat/translate` with `{ chatId, messageIds }` | `{ items }` with translations identified by message ID. Each item can have `text` and `voice` translations. A null translation leaves the original as-is. |
| `POST /api/chat/send` with `{"chatId":"<chat-id>","text":"<reply>"}` | `{"ok":true}` after Beeper accepts one text message. |

The Chat routes require the bridge bearer token and an allowed private Host. Cloudflare headers cause a 403, including on CORS preflights. Responses use `Cache-Control: no-store`. The bridge keeps account and chat list snapshots in memory, refreshes them in the background, and waits up to about three seconds for a cold list before serving available rows. The unread count can be partial during initial loading. Transient upstream read failures use bounded retries with back-off. Bridge logs include the route, status, count and elapsed time.

## Beeper allowlist and beta limits

The bridge permits `GET /v1/accounts`, `GET /v1/chats`, `GET` or `POST /v1/chats/{chatID}/messages`, and `GET /v1/assets/serve?url=…`. The existing reply POST accepts only a non-empty `text` field. The new asset read uses an `mxc://` or `localmxc://` URL from the requested message in the re-read chat. Other operations fail before reaching Beeper. [Beeper Desktop API reference](https://developers.beeper.com/desktop-api-reference/)

FFmpeg converts voice attachments to 16 kHz mono WAV. The bridge removes the temporary input and WAV after processing. Files up to 32 MiB and five minutes are supported. The app receives message metadata and text without asset URLs or paths. Transcripts and translations are cached in bridge memory per chat and message. The two new routes re-read the chat and only process the selected visible messages. Translation sends one local Ollama batch for messages loaded on open, then a batch for new transcripts after each click. Model inference stays on the bridge PC and logs do not contain chat content or asset identifiers.

The reader displays Beeper's latest message batch. Older server-side history, attachment playback, quoted-message replies, editing, and marking a chat unread are outside this beta. Chats Beeper marks read-only show the reader without voice reply.

The test suite and Even simulator fixture use synthetic Beeper data. The RTX 5090 smoke test used eSpeak NG-generated speech in Ogg/Opus, M4A/AAC, and MP3. Warm calls including decoding took 0.11–0.13 seconds per 1.3–2.3 second clip. Cold calls took 13–39 seconds. Forced Cantonese tagged 4/4 Cantonese clips correctly with 14 character edits over 29 reference characters. Forced Mandarin tagged 4/4 with 6 edits over 31 characters. Auto tagged only 1/4 of these short Cantonese clips as Cantonese. This small synthetic sample measures the pipeline and is insufficient to estimate real voice-note accuracy.

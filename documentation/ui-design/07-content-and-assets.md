# 07 — Content & Assets

All user-facing copy (as the localizable string table) and the complete asset inventory
(icons, logo, illustrations). Every visible string in the app comes from here; no
hardcoded text in components. All copy is **original** to Watai.

Conventions: keys are namespaced `area.element`. `{placeholders}` are interpolated.
Voice/tone: plain, calm, second person, no exclamation overuse, no emoji in chrome.

---

## 1. Global / common

| Key | String |
| --- | --- |
| `common.appName` | Watai |
| `common.continue` | Continue |
| `common.cancel` | Cancel |
| `common.save` | Save |
| `common.done` | Done |
| `common.back` | Back |
| `common.close` | Close |
| `common.delete` | Delete |
| `common.remove` | Remove |
| `common.retry` | Retry |
| `common.copy` | Copy |
| `common.copied` | Copied |
| `common.edit` | Edit |
| `common.rename` | Rename |
| `common.share` | Share |
| `common.export` | Export |
| `common.settings` | Settings |
| `common.search` | Search |
| `common.newChat` | New chat |
| `common.undo` | Undo |
| `common.notNow` | Not now |
| `common.openSettings` | Open settings |
| `common.required` | Required |
| `common.optional` | Optional |

---

## 2. Onboarding

| Key | String |
| --- | --- |
| `welcome.headline` | Chat, talk, and create with your own AI. |
| `welcome.bullet1` | Streaming conversations |
| `welcome.bullet2` | Talk with voice, in and out |
| `welcome.bullet3` | Generate images inline |
| `welcome.getStarted` | Get started |
| `welcome.haveAccount` | I already have an account |
| `welcome.noAccount` | Continue without an account |
| `welcome.localConfirmTitle` | Use Watai without an account? |
| `welcome.localConfirmBody` | Your chats and images stay on this device only. You can sign in later to sync. |
| `auth.signInTitle` | Sign in |
| `auth.signUpTitle` | Create your account |
| `auth.emailLabel` | Email |
| `auth.emailPlaceholder` | you@example.com |
| `auth.emailInvalid` | Enter a valid email address. |
| `auth.continueWith` | Continue with {provider} |
| `auth.or` | or |
| `auth.codeSent` | We sent a code to {email}. |
| `auth.codeLabel` | Verification code |
| `auth.resend` | Resend code |
| `auth.resendIn` | Resend in {seconds}s |
| `auth.legal` | By continuing you agree to the Terms and Privacy Policy. |

---

## 3. BYO-key setup wizard

| Key | String |
| --- | --- |
| `key.title` | Connect your AI |
| `key.stepEndpoint` | Endpoint |
| `key.stepModels` | Models |
| `key.stepTest` | Test |
| `key.baseUrlLabel` | Base URL |
| `key.baseUrlPlaceholder` | https://your-resource.services.ai.azure.com/openai/v1 |
| `key.baseUrlHelp` | The OpenAI-compatible endpoint of your Azure AI resource. |
| `key.baseUrlInvalid` | Enter a valid https URL ending in /openai/v1. |
| `key.apiKeyLabel` | API key |
| `key.apiKeyPlaceholder` | Paste your key |
| `key.security` | Your key is stored only on this device and is never sent to Watai's servers. |
| `key.encryptToggle` | Encrypt key with a passphrase |
| `key.encryptHelp` | You'll enter this passphrase each time you open Watai. It can't be recovered. |
| `key.passphraseLabel` | Passphrase |
| `key.modelChatLabel` | Chat model |
| `key.modelTranscribeLabel` | Transcription model |
| `key.modelImageLabel` | Image model |
| `key.modelTtsLabel` | Voice (text-to-speech) model |
| `key.modelHelp` | The deployment name from your Azure resource. |
| `key.advanced` | Advanced |
| `key.reasoningEffort` | Reasoning effort |
| `key.maxTokens` | Max response tokens |
| `key.test` | Test connection |
| `key.testAll` | Re-test all |
| `key.statusIdle` | Not tested |
| `key.statusTesting` | Testing… |
| `key.statusOk` | Connected |
| `key.statusFailed` | {reason} |
| `key.statusSkipped` | Skipped |
| `key.finish` | Start using Watai |
| `key.partialWarning` | Chat is ready. Some features are unavailable until their models connect. |
| `key.corsBlocked` | Your browser couldn't reach this endpoint directly (CORS). Check the endpoint or see setup help. |

---

## 4. Permissions

| Key | String |
| --- | --- |
| `mic.title` | Talk to Watai |
| `mic.body` | Watai needs your microphone to transcribe speech and run voice conversations. Audio is sent only to your configured AI endpoint. |
| `mic.enable` | Enable microphone |
| `mic.denied` | Microphone access is off. Turn it on in your browser settings to use voice. |
| `mic.unavailable` | No microphone was found on this device. |

---

## 5. Chat

| Key | String |
| --- | --- |
| `chat.emptyGreeting` | How can I help? |
| `chat.composerPlaceholder` | Message Watai |
| `chat.composerOffline` | You're offline |
| `chat.composerUnconfigured` | Connect your AI to start |
| `chat.send` | Send message |
| `chat.stop` | Stop response |
| `chat.startVoice` | Start voice |
| `chat.dictate` | Dictate |
| `chat.attach` | Add attachment |
| `chat.typing` | Watai is thinking… |
| `chat.stopped` | Stopped |
| `chat.continue` | Continue |
| `chat.regenerate` | Regenerate |
| `chat.regenerateSame` | Try again |
| `chat.regenerateEffort` | Change reasoning effort |
| `chat.regenerateModel` | Change model |
| `chat.readAloud` | Read aloud |
| `chat.goodResponse` | Good response |
| `chat.badResponse` | Bad response |
| `chat.feedbackNote` | Tell us more (optional) |
| `chat.copyMarkdown` | Copy as Markdown |
| `chat.selectText` | Select text |
| `chat.editResend` | Edit & resend |
| `chat.editing` | Editing message |
| `chat.deleteMessage` | Delete message |
| `chat.messageDeleted` | Message deleted |
| `chat.jumpToLatest` | New messages |
| `chat.temporaryBadge` | Temporary |
| `chat.temporaryNotice` | This chat won't be saved. |
| `chat.suggestion1` | Summarize a document |
| `chat.suggestion2` | Brainstorm names for… |
| `chat.suggestion3` | Create an image of… |
| `chat.suggestion4` | Explain a concept simply |
| `chat.suggestion5` | Draft an email |
| `chat.suggestion6` | Plan a trip |
| `chat.setupNudgeTitle` | Connect your AI to start chatting |
| `chat.setupNudgeButton` | Connect your AI |
| `code.copy` | Copy code |
| `code.wrap` | Wrap lines |
| `attach.photoLibrary` | Photo library |
| `attach.takePhoto` | Take photo |
| `attach.chooseFile` | Choose file |
| `attach.unsupported` | That file type isn't supported. |
| `attach.tooLarge` | That file is too large (max {size}). |
| `attach.noVision` | The current model can't read images. Choose another in Models. |

---

## 6. Model selector

| Key | String |
| --- | --- |
| `model.title` | Model |
| `model.manage` | Manage models |
| `model.setup` | Set up a model |
| `model.effortLabel` | Reasoning: {level} |

---

## 7. History & search

| Key | String |
| --- | --- |
| `history.search` | Search |
| `history.pinned` | Pinned |
| `history.today` | Today |
| `history.yesterday` | Yesterday |
| `history.prev7` | Previous 7 days |
| `history.prev30` | Previous 30 days |
| `history.archived` | Archived |
| `history.empty` | No conversations yet |
| `history.emptyCta` | Start a chat |
| `history.pin` | Pin |
| `history.unpin` | Unpin |
| `history.archive` | Archive |
| `history.unarchive` | Unarchive |
| `history.duplicate` | Duplicate |
| `history.clearMessages` | Clear messages |
| `history.deleteThread` | Delete |
| `history.threadDeleted` | Conversation deleted |
| `history.renamePlaceholder` | Conversation name |
| `search.placeholder` | Search chats |
| `search.results` | Results ({count}) |
| `search.empty` | No results for "{query}" |
| `search.recent` | Recent |
| `search.filterImages` | Has images |
| `search.filterVoice` | Voice |

---

## 8. Voice mode

| Key | String |
| --- | --- |
| `voice.connecting` | Starting… |
| `voice.listening` | Listening |
| `voice.thinking` | Thinking |
| `voice.speaking` | Speaking |
| `voice.muted` | Muted |
| `voice.mute` | Mute |
| `voice.unmute` | Unmute |
| `voice.keyboard` | Keyboard |
| `voice.end` | End |
| `voice.captions` | Captions |
| `voice.ttsUnavailable` | Set a voice model in Settings to hear replies. |
| `voice.error` | Something went wrong. Try again. |

---

## 9. Images

| Key | String |
| --- | --- |
| `image.creating` | Creating image… |
| `image.save` | Save |
| `image.variations` | Variations |
| `image.edit` | Edit |
| `image.useAsInput` | Use as input |
| `image.copyPrompt` | Copy prompt |
| `image.delete` | Delete image |
| `image.galleryTitle` | Images |
| `image.galleryEmpty` | No images yet |
| `image.size` | {width}×{height} |
| `image.editPromptPlaceholder` | Describe the change |

---

## 10. Settings

| Key | String |
| --- | --- |
| `settings.title` | Settings |
| `settings.groupGeneral` | General |
| `settings.groupData` | Data |
| `settings.groupApp` | App |
| `settings.account` | Account |
| `settings.models` | Models & keys |
| `settings.personalization` | Personalization |
| `settings.voice` | Voice |
| `settings.dataControls` | Data controls |
| `settings.appearance` | Appearance |
| `settings.about` | About |
| `settings.signOut` | Sign out |
| `settings.signOutConfirm` | Sign out of Watai? Your key and local data on this device will be removed. |
| `settings.localBadge` | Local |
| `account.editProfile` | Edit profile |
| `account.nameLabel` | Name |
| `account.mode` | Mode |
| `account.modeLocal` | Local (this device) |
| `account.modeSynced` | Synced |
| `account.syncedSoon` | Syncing is coming soon. |
| `account.devices` | Devices |
| `account.delete` | Delete account |
| `account.deleteConfirm` | This permanently deletes your account and all data. Type DELETE to confirm. |
| `models.connection` | Connection |
| `models.replaceKey` | Replace key |
| `models.chatDefaults` | Chat defaults |
| `models.systemPrompt` | System prompt |
| `models.streaming` | Streaming |
| `models.capabilities` | Capabilities |
| `models.capVision` | Reads images |
| `models.capImageEdit` | Edits images |
| `models.capTranscribeStream` | Live transcription |
| `models.capTts` | Voice output |
| `models.saved` | Saved |
| `personalization.aboutYou` | What should Watai know about you? |
| `personalization.howRespond` | How should Watai respond? |
| `personalization.memory` | Memory |
| `personalization.manageMemory` | Manage memory |
| `personalization.clearMemory` | Clear all memory |
| `personalization.memoryEmpty` | Watai hasn't saved anything yet. |
| `personalization.suggestions` | Show prompt suggestions |
| `voiceSettings.engine` | Voice output |
| `voiceSettings.engineTts` | Read aloud |
| `voiceSettings.engineRealtime` | Realtime |
| `voiceSettings.experimental` | Experimental |
| `voiceSettings.voice` | Voice |
| `voiceSettings.rate` | Speech rate |
| `voiceSettings.vad` | Mic sensitivity |
| `voiceSettings.autoStopDictation` | Auto-stop dictation on silence |
| `voiceSettings.showCaptions` | Show captions |
| `data.sync` | Sync history |
| `data.temporaryDefault` | Start new chats as temporary |
| `data.retention` | Keep chats |
| `data.retentionForever` | Forever |
| `data.retention30` | 30 days |
| `data.retention90` | 90 days |
| `data.exportAll` | Export all data |
| `data.deleteAll` | Delete all data |
| `data.deleteAllConfirm` | This permanently deletes all chats, images, and your saved key on this device. Type DELETE to confirm. |
| `data.where` | Where your data lives |
| `data.whereBody` | Right now everything is stored only on this device. |
| `data.usage` | {threads} chats · {images} images · {size} |
| `appearance.theme` | Theme |
| `appearance.system` | System |
| `appearance.light` | Light |
| `appearance.dark` | Dark |
| `appearance.textSize` | Text size |
| `appearance.density` | Density |
| `appearance.comfortable` | Comfortable |
| `appearance.compact` | Compact |
| `appearance.reduceMotion` | Reduce motion |
| `appearance.language` | Language |
| `about.version` | Version {version} |
| `about.whatsNew` | What's new |
| `about.privacy` | Privacy & security |
| `about.licenses` | Open-source licenses |
| `about.support` | Support |
| `about.attribution` | Powered by your Azure OpenAI deployments. |

---

## 11. Errors (mapped to API taxonomy)

Keys align with [../03-api-integration.md](../03-api-integration.md) §6 normalized codes.

| Key | String |
| --- | --- |
| `error.offline.title` | You're offline |
| `error.offline.body` | You can read past chats. New messages need a connection. |
| `error.unauthorized` | Your API key was rejected. Check it in Models. |
| `error.deploymentNotFound` | Model "{model}" wasn't found. Check the name in Models. |
| `error.rateLimited` | Too many requests. Retrying in {seconds}s. |
| `error.contentFiltered` | This request was blocked by a content policy. Try rephrasing. |
| `error.server` | The service had a problem. Try again. |
| `error.timeout` | That took too long. Try again. |
| `error.unsupported` | The current model doesn't support this. Choose another in Models. |
| `error.generic` | Something went wrong. |
| `error.backOnline` | Back online |

---

## 12. Accessibility labels (icon-only & dynamic)

| Key | String |
| --- | --- |
| `a11y.openMenu` | Open conversations |
| `a11y.closeMenu` | Close conversations |
| `a11y.newChat` | New chat |
| `a11y.threadMenu` | Conversation options |
| `a11y.messageMenu` | Message options |
| `a11y.attach` | Add attachment |
| `a11y.dictate` | Dictate |
| `a11y.send` | Send message |
| `a11y.stop` | Stop response |
| `a11y.startVoice` | Start voice conversation |
| `a11y.revealKey` | Show key |
| `a11y.hideKey` | Hide key |
| `a11y.removeAttachment` | Remove {name} |
| `a11y.responseComplete` | Response complete |
| `a11y.responseStopped` | Response stopped |
| `a11y.imageZoom` | Zoom image |

---

## 13. Asset inventory — icons

System icons are **original/licensed line icons**, 24px grid default, 1.75px stroke,
`currentColor`, exported as inline SVG (tree-shakeable). Provide 16/20/24 where used.
No proprietary third-party icon is copied.

| Icon id | Used by |
| --- | --- |
| `menu` | AppBar menu (drawer) |
| `edit-square` | New chat |
| `more-horizontal` | Overflow / actions |
| `more-vertical` | Row actions |
| `chevron-down` | ModelSelector, selects |
| `chevron-right` | Settings rows, disclosure |
| `chevron-left` / `arrow-left` | Back |
| `close` | Close overlays |
| `search` | Search |
| `plus` | Attach |
| `arrow-up` | Send |
| `stop-square` | Stop streaming |
| `mic` | Dictation / voice |
| `mic-off` | Muted |
| `keyboard` | Voice → keyboard |
| `waveform` | Voice/dictation |
| `image` | Image / gallery |
| `wand` | Variations / generate |
| `download` | Save image |
| `share` | Share |
| `copy` | Copy |
| `check` | Success / selected |
| `pin` | Pin |
| `archive` | Archive |
| `trash` | Delete |
| `eye` / `eye-off` | Reveal/hide key |
| `refresh` | Regenerate / retry |
| `thumbs-up` / `thumbs-down` | Feedback |
| `volume` | Read aloud |
| `settings-gear` | Settings |
| `user` | Account / avatar fallback |
| `sun` / `moon` / `display` | Appearance theme |
| `lock` | Key encryption |
| `info-circle` | About / info |
| `alert-triangle` | Warning |
| `alert-circle` | Error |
| `wifi-off` | Offline |
| `sparkle` | Personalization / brand accent |

Each icon ships in a single SVG sprite or per-file modules; named exports map to these
ids. Sizes via `--icon-*`. RTL-sensitive icons (chevrons, back, share) mirror in RTL.

---

## 14. Asset inventory — brand & illustration

| Asset | Spec |
| --- | --- |
| `logo/wordmark` | "Watai" wordmark, SVG, single-color `currentColor`, light/dark via token. |
| `logo/glyph` | Brand mark (◆-style sparkle), SVG, used at 24/32/48; favicon + PWA maskable icon derived from it. |
| `pwa/icon-192`, `icon-512`, `maskable-512` | PNG app icons for the manifest. |
| `illustration/empty-history` | Optional simple line illustration for empty history. |
| `illustration/empty-gallery` | Optional simple line illustration for empty gallery. |
| `illustration/welcome` | Optional decorative panel (expanded welcome only; non-essential). |
| `og/social-card` | Social share image (non-essential for app function). |

- All brand/illustration assets are **original**. The glyph is a simple geometric mark, not
  derived from any third-party logo.
- Illustrations are optional; their absence falls back to an icon + text EmptyState.

---

## 15. Content rules

1. No string is hardcoded in a component; all come from this table via an i18n layer.
2. Sentence case for everything except `label`-type overlines (which are uppercase via
   CSS, not in the string).
3. No emoji in app chrome, labels, or status; use icons. (Message **content** may contain
   emoji authored by the user or model.)
4. Errors are plain, blame-free, and actionable; never expose keys, stack traces, or raw
   provider payloads.
5. Placeholders use `{named}` tokens; pluralization handled by the i18n layer.

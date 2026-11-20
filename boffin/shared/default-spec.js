// Shown until the owner saves their own copy.
export const DEFAULT_SPEC = `# What Boffin is

Boffin is a mobile-friendly chat page for the Cursor CLI, the Grok CLI, and the Pi CLI. One server keeps one active conversation, and a log of each conversation that has ended. The active conversation is tied to one working directory, one agent, and one model. The working directory is the first argument to the server, or the current directory. Which CLIs are enabled is set in the server config. The owner chooses the agent (when more than one is enabled) and a model when starting a new chat. More than one person can take part in it.

# Sign-in

The page first shows a landing page. The slogan is “The AI assistant free to shoot itself in the foot.” Under the start button is a sample of the shared conversation (see Sample script). Start opens the password form when nobody has signed in yet. The form says this phase is invite-only. A passkey can be created only when the page is served over HTTPS, or over HTTP on localhost, and the address is a hostname rather than an IP address. Passkeys are bound to the hostname they were created on (see BUGS).

The owner's username and password come from the config file. \`BOFFIN_USERNAME\` and \`BOFFIN_PASSWORD\` override the file. The username must not contain a colon. When set, the password must be at least 8 characters, and the placeholders in the example config are rejected. Once the owner has a passkey in the state file, the password may be omitted from the config file. The owner's name in the conversation is that username.

The first time anyone signs in, Start asks for that username and password and checks them against the config file. A rejected password asks again. When the password is accepted, the page asks the owner to add a passkey, and the owner should add it right after the first sign-in. Sign-in is finished only after that passkey exists. Until then, the app does not block access to the other API routes for anyone who has the owner's username and password. The browser does not keep the password. After that, Start asks for a username. The server returns a sign-in challenge for every username. For every name with at most 8 passkeys, each credential-id length appears the same number of times: as many as the fullest such account has of that length, with placeholders added until the list has at least 8 ids. That mix does not show whether the name exists. A name with more than 8 passkeys lists each of them and is left out of that mix, so the extra ids appear only on that name. Placeholders stay the same across a restart because their key is kept in the state file. A list changes when a name first gets a passkey. The page then asks for a passkey, including one saved on another device. A passkey for a different person is refused. The password is not asked again.

Each client address may submit the password form 8 times in 15 minutes, counting from its first submission. A wrong Basic password on other routes counts too, while the password is still accepted. A correct Basic password leaves the count unchanged. A separate count allows 30 passkey requests from that address in 15 minutes, counting from its first such request: checking an invitation link, registering a passkey, asking for a sign-in challenge, submitting a sign-in, starting or finishing a join, and each step of adding a passkey. Checking sign-in status without an invitation link has its own limit of 60 requests in 15 minutes. Past any limit, the server refuses further attempts until that window ends, and sends how many seconds are left. The counts live in memory, so a restart clears them. IPv6 addresses in one global or unique-local /64 share one count. An IPv4 address written as an IPv4-mapped IPv6 address, in dotted or hex form, is counted as the IPv4 address. Every other address, including IPv4, localhost, and link-local, is counted one by one. The exception is a connection over loopback, such as from a reverse proxy on the same host: it is counted under the last entry of its X-Forwarded-For header when that is a valid IP address, so clients behind such a proxy have separate counts. Connections from any other address ignore that header. A missing or malformed header is ignored too, so the connection's own address is used. A process on the same host can connect over loopback and set the header itself. Clients behind a proxy on another host share the proxy's address and therefore a count.

Only the owner can invite people, from Members. Members stays in Settings when the owner is the only person in the conversation. Everyone who has joined before but is not in this conversation is listed under Previously invited, including people who were removed from it. Clicking their name, or their name on a message they sent, adds them to this conversation. A new person still uses an invitation link.

A person who opens a valid invitation link does not see Start. The page shows that the owner invited them to use Boffin, and a link to accept it. Accepting asks for a username and a passkey. A later visit uses Start, that username, and the passkey, including from another device that has the same passkey.

The server keeps each passkey's public key. The private key stays with the person. A signed-in person can add another passkey and can remove one. The last passkey cannot be removed. Removing a passkey ends every active session signed in with it. Adding a passkey when they already have 8 or more passkeys first warns that sign-in will then list more than 8 passkey ids, so anyone could tell that name has passkeys and how many; they can cancel or add it anyway. Adding a passkey from Settings sets its label then. The label is trimmed, it may be empty, and it may be up to 40 characters. It cannot be changed later. A passkey saved at first sign-in, or a passkey saved earlier, starts without a label. Removing a person does not delete their passkeys: those passkeys still open the conversations and logs that person may keep.

A signed-in person can log out from Settings. That ends this browser's session. A later visit uses Start, that username, and the passkey. A session never expires. Sessions live in the server's memory, so a restart signs everyone out, and they sign in again with their username and passkey.

# Sample script

The landing page shows a sample of the shared conversation under the start button, with more than one member. Theme, size, and language inside the sample change only the sample. The page's own theme, size, and language stay as they are.

Spec opens a short stand-in inside the sample, not this text. Edit deletes “color” and types “background color”. Chat returns to the sample, and the names then use that background color. Members opens the members list for the people in the sample. Previously invited lists people from an earlier conversation; clicking a name adds them to the sample. Invite opens a note that you can invite people in the real application, and does not do it. Remove takes that person out of the sample; their messages stay.

The sample plays Ryu and Ken asking to move Export next to Settings. Messages appear one by one, with the agent typing. Then the sample refreshes, and Export becomes an icon beside Settings. That icon downloads the sample conversation. The sample accepts a message. After the first send it shows that the real application will reply, and does not call the agent.

Attach opens a note that you can attach files in the real application, and does not do it. Passkeys opens a note that you can manage passkeys in the real application, and does not do it. Log out opens a note that you can log out in the real application, and does not do it.

# Conversation

There is one active transcript, shared by the owner and anyone who has joined.

The page lists the people in the active conversation. A user message shows the name of the person who sent it, and that person's messages use their own color. The people list and the names in the header use the same color. Until the page is reloaded, the same name keeps the same color (see BUGS). The log names that person too.

The first message starts a CLI chat. Later messages resume that same chat. The chat id is saved with the transcript.

Only the owner can start a new chat. New chat ends the active conversation and keeps its log, then starts a fresh transcript and forgets the chat id, so the next message starts a fresh CLI chat. The owner picks the agent when more than one CLI is enabled, and picks a model for that agent. People who had joined are not in the new conversation, and every invitation is cancelled. The kept log remains for them to export later, whether or not anyone downloads it during new chat. If a run is still going, new chat is refused. Anyone in the active conversation can export the log as JSON, Markdown, EPUB (with embedded images when available), or a print view for Save as PDF. The owner can export JSON when starting a new chat. After that, the owner has no list of ended logs and cannot download them in the app. Invitees with a kept log can export the same formats from the conversation list. JSON and Markdown list attachment and image names but do not include file bytes. EPUB embeds images that are still stored on the server. Non-image attachments are named only. The files record the agent and the model, not the working directory. The agent is \`cursor\`, \`grok\`, or \`pi\`. The base file name looks like \`boffin-chat-2026-10-17T031900Z\` with extension \`.json\`, \`.md\`, \`.epub\`, or \`.html\` (print). For example \`boffin-chat-2026-10-17T031900Z.json\`. A kept log uses the time that conversation ended. A log cut off by removal uses the time of the removal.

Only one agent run happens at a time. Sending again while a run is active is refused. Anyone in the conversation can stop the run.

Closing the page does not stop a run. Once a person is in the active conversation, opening it again shows the saved transcript, and if the run is still going the page follows it until it finishes.

When a person who joined by invitation opens the page, the page looks at the conversations they have joined. If the only one is the active conversation and they are still in it, the page opens it. Otherwise the page lists every conversation they have joined. Choosing the active conversation opens it when they are still in it. Choosing a conversation they are no longer in downloads the log they may keep. An ended conversation includes the whole log. A conversation they were removed from includes only the part before the removal.

The active transcript and every kept log are written to the state file (\`state_file\` in the config, \`data/state.json\` by default). A state file that is not valid version-1 JSON is refused, so a bad file is not overwritten.

# The agent

All agents are CLIs. The server spawns the chosen one in the working directory, with no shell, reads its JSON stream, and maps events into the transcript. Flags and event shapes differ; the process boundary does not.

The Cursor Agent SDK is not used. It covers only Cursor, needs a Node package and a different login, and the CLI already runs the agent loop in this working directory. MCP is not used as a backend. It offers tools to an agent. It does not start a chat, resume one, pick a model, or auto-approve. Grok Build is the \`grok\` CLI, not a second runtime. Cursor as the only agent, with Grok as an MCP tool, is a different product.

For Cursor it runs \`agent\` (or \`agent_bin\` from the config). The arguments are:

- \`--print\`
- \`--output-format stream-json\`
- \`--stream-partial-output\`
- \`--trust\`
- \`--model\` and the chosen Cursor model
- \`--force\` when \`force\` is true (the default)
- \`--resume\` and the chat id on follow-up turns
- \`--image\` and a file path for each attached image
- \`--\` and then the sender's name, a colon, a space, and the message, so a message that starts with a dash is not treated as a flag. After the message, the prompt includes a shopping list instruction with the path of the JSON file.

For Grok it runs \`grok\` (or \`grok_bin\` from the config). The arguments are:

- \`--output-format streaming-json\`
- \`--cwd\` and the working directory
- \`--model\` and the Grok model id
- \`--reasoning-effort\` when the chosen model has an effort, such as high for Grok 4.7 High
- \`--always-approve\` when \`force\` is true (the default)
- \`--resume\` and the chat id on follow-up turns
- \`--single=\` and then the sender's name, a colon, a space, and the message, so a message that starts with a dash is not treated as a flag. After the message, the prompt includes a shopping list instruction with the path of the JSON file.

For Pi it runs \`pi\` (or \`pi_bin\` from the config). The arguments are:

- \`--mode json\`
- \`--approve\`, so Pi loads the workdir's project resources (JSON mode skips them when trust has not been saved)
- \`--model\` and the Pi model id when the chosen model is not \`default\`
- \`--thinking\` and the chosen thinking effort when set (omitted when left empty so Pi uses its configured default)
- \`--session-id\` and the session id on follow-up turns
- \`--\` and then \`@<path>\` for each attached image, followed by the sender's name, a colon, a space, and the message (with a leading space when the prompt starts with \`@\`), so a message that starts with a dash or \`@\` is not treated as a flag or file reference. After the message, the prompt includes a shopping list instruction with the path of the JSON file.

An agent's chat id or session id is passed back only to that agent, never to a different one. The default Cursor model is Composer 2.5. The default Grok model is Grok 4.7 High. The default Pi model is \`default\` (Pi's own configured default model). Cursor and Grok offer first-party models; Pi accepts \`default\` or any \`provider/model\` id its CLI can run.

When Grok is enabled, anyone in the conversation can see that Grok account's quota as a thin bar in the header. The percentage text appears only while the pointer is over the bar. Settings lists Refresh and does not show the figure. Current Cursor plans share that pool with Grok, so the same bar stays up when both CLIs are enabled even if the active chat is Cursor. Cursor legacy plans do not share it; their usage is a separate Cursor quota and is not shown. The figure is still the latest weekly (or monthly) limit Grok Build wrote to its local log (\`logs/unified.jsonl\` under the Grok home, \`~/.grok\` by default), not a Cursor snapshot. Grok Build writes that snapshot when it fetches billing for \`/usage\` or when Refresh asks Grok Build over ACP (\`_x.ai/billing\` on \`grok agent stdio\`). That method is the official CLI's billing fetch, not a documented public API; xAI's terms do not name it, so they could change or restrict it, and the Grok account's terms still apply. Refresh does not automate the TUI to type \`/usage\`: there is no terminal under systemd, and the TUI would only trigger the same fetch. A Cursor-only deployment has no usage bar: Cursor does not write an equivalent local snapshot. If no snapshot is there yet, the bar is empty, and hovering it says Grok usage is not available. Anyone in the conversation can use Refresh in Settings to run that billing fetch and reread the log; the server allows one refresh per minute.

More than one person may be in the conversation, and a send still starts one agent run with that person's name and message. The assistant does not need a full reply to every message. Greetings, sign-offs, and small talk clearly meant for other people, such as good night, need no answer unless the sender is asking the assistant for something. When there is nothing to do, the assistant may send nothing or only a short acknowledgment.

Assistant text is shown as it streams. Tool calls appear with a name and a short summary. Images the agent creates are stored and shown in the transcript, and each one can be downloaded. A file the agent creates or changes during the run, or names in its reply, is stored and offered for download when it stays inside the workdir and is 8 MB or smaller. Up to 8 such files are offered. Sign-in config, the data directory, git metadata, and dependencies are not offered. A file or image larger than 8 MB (8,388,608 bytes) is not stored or shown, and no notice is given. The first bad line of agent output in a run becomes one error notice. Later bad lines are logged on the server only. Lines after a bad line are still read.

Files in Settings lists every file tied to this conversation: media and images from the transcript, and user attachments kept under \`.boffin/uploads\`. Everyone in the conversation can open the list, view a file when the browser can show it, and download any listed file. Only the owner sees a second list for the working directory: publishable paths up to 8 MB, with the same exclusions as agent downloads. That list is view and download only; the Files page does not create, rename, move, or delete anything in the workdir.

# Shopping list

The page has a Shopping list. Anyone in the conversation can open it from the header. It lists things people want to buy, and things already bought. The list is kept in \`shopping-list.json\` next to the state file. A missing file is an empty list. New chat does not clear it.

Anyone in the conversation can add an item, mark it bought, or remove it. The agent must also keep this file up to date. Each prompt includes the path and the rules. When a person says they want to buy something, the agent adds that item, with that person's name as \`wantedBy\`, unless the same name is already on the list. When a person says they bought something, the agent marks that item bought and sets \`boughtBy\` to that person's name. The agent does not invent items, and does not rewrite the file when the message is not about buying. The assistant may send a short acknowledgment, or nothing.

The file is version-1 JSON: \`{"version":1,"items":[...]}\`. Each item has \`id\` (a UUID), \`name\`, \`wantedBy\`, \`bought\`, \`boughtBy\`, and \`note\`. \`bought\` is true or false. \`wantedBy\` and \`boughtBy\` are names, and may be empty. \`note\` may be empty. There may be up to 200 items. A name may be up to 200 characters. A note may be up to 500 characters. A person's name on an item may be up to 40 characters.

Sign-in secrets are not passed to the agent's environment or arguments. The agent can still read files in the workdir (see BUGS).

# Composer

A message may be up to 32768 characters.

Up to 8 files can be attached, and each file may be up to 4 MB.

Image files are sent to Cursor with \`--image\` and to Pi as \`@<path>\` arguments. Grok has no image flag; image paths are included in the prompt only. Every file, images included, is saved in \`.boffin/uploads\` under the workdir, and its path is included in the prompt.

On a touch device, such as a phone or tablet, Enter inserts a newline and the send button sends. On other devices, Enter sends and Shift+Enter inserts a newline. While a run is active, Enter inserts a newline and the button becomes Stop.

# Appearance

The language choice is remembered in the browser. A browser language tag selects a language when the tag is unambiguous. Each language has its own flag. Each language is labeled in its own language, except Indonesia, which is labeled with the country's name.

- English is labeled English and uses the St George's Cross of the Kingdom of England. An empty chat shows The LORD bless thee, and keep thee, from Numbers 6:24 in the King James Bible.
- 日本語 uses the flag of Japan. An empty chat shows 天の御加護がありますように.
- Melayu uses the flag of the Federated Malay States. An empty chat shows Salam.
- Kedayan uses the Sabah state flag. The menu name is Kedayan. Kedayan has no official spelling, so the interface uses the working spelling from the Universiti Brunei Darussalam pronunciation notes: the letter r is dropped, pepet e is written a, and f is written p. The tags kedayan and kadayan both select it. An empty chat shows Mualaikum, the Sabah clip of Assalamualaikum that drops the assala half.
- ملايو بروني is Brunei Malay in Jawi. The spelling is Sistem Ejaan Jawi yang Disempurnakan. tidak is written ايندا and hantar is written انتت. It uses the Brunei flag of 1906 to 1959: a yellow field with a white diagonal stripe over a black one, before the crest was added. The tags ms-BN-Arab, ms-Arab, ms-MY-Arab, and ms-bn-jawi select it. Choosing it sets the chrome and the composer to right to left. Each chat message and the spec body follow the direction of their own text. An empty chat shows السلام عليكم.
- Indonesia uses the red-over-white flag of Indonesia. An empty chat shows As-salamu alaykum.
- தமிழ் uses the green Pudukkottai standard. An empty chat shows வணக்கம்.
- 粵語 uses the Hong Kong flag of 1876 to 1955: a blue ensign with the harbor badge of the Peak, a square-rigged ship, a junk, and the waterfront. The tags zh-HK and zh-Hant-HK select it. An empty chat shows 願上帝賜福畀你, spoken Cantonese for Ruth 2:4.
- 中文 uses the national-flag draft 复字第3号 from the 1949 National Flag Pattern Reference Materials: a red field, one yellow star in the canton, and a yellow bar. The tags zh-CN, zh-Hans, zh-Hans-CN, and zh-SG select it. An empty chat shows 全世界无产阶级和被压迫的民族联合起来.
- Pe̍h-ōe-jī is labeled with that romanization and uses the Hearts-in-Harmony flag. The tags nan, nan-TW, and zh-min-nan select it. An empty chat shows Goān Iâ-hô-hoa sù-hok lí, Ruth 2:4 in the vernacular Bible.

Theme is Light, Dark, or System. System follows the device. Light stays light even when the device is dark. The choice is remembered in the browser.

Size is Default or Larger. Larger makes the text and the controls bigger. The choice is remembered in the browser. Size inside the sample changes only the sample.

The layout fits a phone, including the on-screen keyboard.

Static assets are either development or release. Development serves the separate source files so edits show up after refresh; release serves Bun-bundled files with long-lived caching for faster loading over slow links. Only the owner can switch modes; switching to release builds the bundle on the server with Bun. Everyone uses the same mode.

Only the owner sees Update in Settings. It is enabled when the working directory is in a git repository and \`repo_url\` in the config (or the repository's \`origin\` remote when \`repo_url\` is omitted) is a public \`https://\` URL. Updating fetches \`repo_branch\` (\`main\` by default). When the checked-out commit can fast-forward to that tip, including when it is already current, it discards uncommitted changes to tracked files and resets to the fetched commit. If it cannot fast-forward, the update aborts, leaves those changes in place, and shows a message. When the fetch changes nothing under Boffin's project directory, or changes only \`public/\`, the server keeps running without a restart or page reload (rebuilding the release bundle first if release mode is active and \`public/\` or \`shared/\` changed). A fetch that only changes other directories still reports the new commit. When server code changes, the server exits after answering so the service manager restarts it, and the browser waits until a new process is up and reloads the page. A bundle failure after that kind of change still restarts.

# Invitations

Only the owner can create an invitation link. The link does not include the owner's password.

Opening a valid link replaces Start with the invitation. Accepting asks for a username, then the person creates a passkey and joins this conversation. The username is trimmed, it is required, and it may be up to 40 characters. A username is refused if the owner or anyone who has joined before has it, including someone who left the conversation or was in an earlier one. If it is a previous joiner's name, the owner adds that person from Previously invited instead. Each link admits one person. A used or cancelled link admits no one. A signed-out visitor sees the start page with the message “This invitation has already been used.”, which is also shown for cancelled links. A signed-in person who is not in the conversation sees the join form for such a link, and submitting a name shows the same message. Another device joins no one with that link; it signs in with the username and passkey. Opening a link while signed in as someone in the conversation does nothing. The server also refuses a join from anyone signed in as the owner or as someone in the conversation. If the device already holds the passkey of someone in the conversation, the page warns before it creates a passkey. The person can cancel, which opens the sign-in form, or continue to join as a new person with another username. A member on a device without their passkey gets no warning and can join with a different name; see BUGS.

The owner can cancel a link that has not been used. An invite link expires after 30 days. It stays valid until then, or until the owner cancels it or a new chat cancels every invitation. Invite links are saved in the state file, so they survive a restart. The owner can remove a person who has joined. The owner can add someone who joined before by clicking that person's name. That does not use a new link. Their passkey still signs them in. A removed person can no longer open that conversation. They can export its log only through the moment of removal. Later messages stay in the conversation for the people who remain, and are not part of the removed person's export. If that was the only conversation they joined, the page lists it for export and does not open it.

# This spec

This page is the spec. The landing sample shows a short stand-in, not this text. Anyone in the conversation can read this page. Only the owner can edit it and save. The saved text is kept in \`spec.md\` next to the state file and replaces this built-in copy. If that file is missing, this built-in copy is shown again. An empty save is kept as empty. The spec can be up to 100,000 characters. A longer save is refused, and the saved text stays as it was.

# Config

The config file is \`config.json\` in the workdir. The workdir is the first argument, or the current directory when that argument is omitted. A missing workdir is created. A missing config file is written at startup with host \`0.0.0.0\`, port \`8080\`, model \`composer-2.5\`, \`agent_bin\` \`agent\`, \`bun_bin\` \`bun\`, \`force\` true, username \`boffin\`, a random password, and \`state_file\` \`data/state.json\`. \`state_file\` is resolved relative to the workdir. \`model\` is required and must be a first-party Cursor model. \`grok_model\` is optional and defaults to \`grok-4.7/high\`. \`pi_model\` is optional and defaults to \`default\`. \`agents\` is an optional array of \`cursor\`, \`grok\`, and/or \`pi\` and defaults to \`["cursor"]\`. \`grok_bin\` is optional and defaults to \`grok\`. \`pi_bin\` is optional and defaults to \`pi\`. \`repo_url\` is an optional public \`https://\` URL and falls back to git's \`origin\` remote when omitted. \`repo_branch\` is optional and defaults to \`main\`. \`username\` is required unless \`BOFFIN_USERNAME\` is set, and \`password\` is required unless \`BOFFIN_PASSWORD\` is set or the state file already holds an owner passkey. A \`workdir\` key and any unknown key are refused.

# BUGS

Known issues, with their status.

**Members can bypass access rules through the agent.** Status: by design. The agent runs in the workdir with auto-approve on by default (\`--force\` for Cursor, \`--always-approve\` for Grok; Pi runs tool calls without approval prompts and is started with \`--approve\`, so it also loads project-local resources), so it can read and write the files there: the config file, which holds the owner's password until it is removed; the state file, which holds every kept log, the passkey records, and the sign-in placeholder key; and the saved spec file. A member can ask the agent to read logs they were never part of, read the owner's password, or edit this spec. The assistant is free to shoot itself in the foot.

**The owner's password is sent over plain HTTP.** Status: wontfix. Boffin serves plain HTTP and does not handle TLS itself. The default \`host\` is \`0.0.0.0\`, which listens on every interface. The server checks the password before it checks for HTTPS, so the password crosses the network in clear text even when the passkey step then fails. If the network is not trusted, the owner should set \`host\` in \`config.json\` to an address they control, such as \`127.0.0.1\`, and serve Boffin over HTTPS through a proxy.

**Losing every passkey locks the owner out.** Status: open. Once the owner has a passkey, the password is no longer accepted, and nothing else in the app can add a passkey without a signed-in session. Recovery means editing the state file by hand. Keep a second passkey, for example on another device.

**The app assumes the hostname will not change.** Status: open. Passkeys are bound to the hostname they were created on. If the hostname changes, the passkeys stop working and the owner is locked out, as above. Choose the final hostname before the first passkey is created.

**Uploaded files are never deleted.** Status: open. Each file stays in \`.boffin/uploads\` under the workdir. \`.boffin\` has a \`.gitignore\` that ignores everything inside it, so git ignores the uploads.

**Member colors repeat.** Status: open. A name keeps its color until the page is reloaded. The first name drawn takes a hue from that name. Each later name takes an unused hue as far as possible from the ones already chosen. The landing sample is drawn first, so Ryu and Ken take two hues before the people in the conversation. There are 23 hues, and the sample uses two, so a name repeats once the conversation has 22 people. Names from older messages and the Members list use hues too, so a repeat can come sooner. A reload chooses again. The same names, drawn in the same order, keep the same colors. A name can get a different color when the names drawn before it have changed.

**A member can join again from a device without their passkey.** Status: open. The server cannot tell that such a device belongs to a member, and no warning is shown, so a join with a different name makes a second identity for the same person.
`;

export const MAX_SPEC_CHARS = 100_000;

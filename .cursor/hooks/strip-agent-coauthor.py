#!/usr/bin/env python3
"""Strip agent Co-authored-by trailers from git commits (Cursor hooks).

Handles:
  - preToolUse (Shell): drop agent --trailer flags, and strip agent
    Co-authored-by lines from git-commit HEREDOC bodies and -m /
    --message text (quoted, $'…', unquoted, and glued -mfoo) using the
    same trailing-trailer rules as post-tool (mid-body examples stay;
    other statements' heredocs are left alone)
  - postToolUse (Shell): strip agent trailers from the tip and from earlier
    same-Shell commits (reported summaries capped to loud eligible commits,
    or &&-linked quiet commits)

Only removes Co-authored-by lines that name cursoragent@cursor.com.
In commit messages, only the trailing git trailer block is touched so a
body example of that line is kept (`git interpret-trailers --only-input
--only-trailers --no-divider`). Human Co-authored-by trailers are left
untouched. Fail-open on errors. Post-tool amend and chained rewrite try a
non-interactive sign when commit.gpgsign is on or that commit already has
a gpgsig (gpg --pinentry-mode=error, timeout, with -c commit.gpgsign=true),
then fall back to unsigned (stderr breadcrumb). Safe Shell suffixes gate
forge-capable follow-ups; quiet commits stay &&-only.

--amend is not strip-eligible for ancestor discovery (a same-Shell amend
does not add a parent to rewrite), but the tip is still stripped when it
carries an agent trailer after that amend.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import signal
import subprocess
import sys
import tempfile
from typing import Any

AGENT_EMAIL = "cursoragent@cursor.com"
# Exact address only — not a substring of another local-part (e.g. notcursoragent@…).
# Lookahead omits `-` so a glued follow-on flag (`email--signoff`) still matches.
_AGENT_EMAIL_BARE = (
    rf"(?<![A-Za-z0-9._%+-]){re.escape(AGENT_EMAIL)}(?![A-Za-z0-9._%+])"
)
_AGENT_EMAIL_TOKEN = rf"(?:<{re.escape(AGENT_EMAIL)}>|{_AGENT_EMAIL_BARE})"

# Full message lines (any Co-authored-by spelling) that attribute to the Cursor agent.
AGENT_LINE_RE = re.compile(
    rf"(?im)^[ \t]*Co-authored-by:[ \t]*.*{_AGENT_EMAIL_TOKEN}.*(?:\r?\n)?"
)
# git --trailer / --trailer= forms that inject the agent coauthor.
# Unquoted values may include spaces in the display name, but must not span
# across a later `--` flag (e.g. a glued `--signoff` after `>`).
_AGENT_TRAILER_UNQUOTED = rf"""
    Co-authored-by:[ \t]*
    (?:
        (?:[^<"'-]|\-(?!-))*<{re.escape(AGENT_EMAIL)}>
      | {_AGENT_EMAIL_BARE}
    )
    (?:[^\s"'-]|-(?!-))*
"""
# Unique group names: duplicate names in alternatives need Python 3.11+.
# Do not consume leading whitespace before --trailer: a glued follow-on flag
# (e.g. ...>--signoff) must keep the separator space before --trailer so it
# does not concatenate onto the previous argv word (e.g. -m "x"--signoff).
# Unique abbreviations Git accepts for --trailer (`--tr` … `--trailer`).
# `--t` is ambiguous with --template and must not match.
AGENT_TRAILER_FLAG_RE = re.compile(
    rf"""(?ix)
    --tr(?:a(?:i(?:l(?:e(?:r)?)?)?)?)?
    (?:
        =(?P<eq_q>["'])(?P<eq_v>Co-authored-by:[ \t]*[^"']*{_AGENT_EMAIL_TOKEN}[^"']*)(?P=eq_q)
      | =(?P<eq_u>{_AGENT_TRAILER_UNQUOTED})
      | [ \t]+(?P<sp_q>["'])(?P<sp_v>Co-authored-by:[ \t]*[^"']*{_AGENT_EMAIL_TOKEN}[^"']*)(?P=sp_q)
      | [ \t]+(?P<sp_u>{_AGENT_TRAILER_UNQUOTED})
    )
    """,
)

# Git emits this summary only after creating or amending a commit. Matching it
# against HEAD prevents a post-tool hook from rewriting an unrelated tip.
COMMIT_SUMMARY_RE = re.compile(
    r"(?m)^\[[^\r\n\]]* (?P<commit>[0-9a-f]{7,64})\](?:\s|$)"
)
# `|&` is one shlex token when punctuation_chars includes `|` and `&`.
SHELL_CONTROL_OPERATORS = frozenset({";", "&&", "||", "|", "&", "|&"})
CD_DIRECTORY_OPERATORS = frozenset({"&&", ";"})
DIRECTORY_CHANGING_BUILTINS = frozenset({"cd", "pushd"})
# After a commit, read-only git follow-ups (see SAFE_SUFFIX_SHELL_OPERATORS).
# Statements reached only via `&&` may use the full set. After a `;`
# (including newline→`;`), only `git status` without `-v`/`--verbose`, or
# `true` / `:`, so a failed commit can still exit 0 without a forge-capable
# follow-up. Quiet-commit stripping stays `&&`-only.
SAFE_SUFFIX_GIT_SUBCOMMANDS = frozenset(
    {"status", "log", "diff", "show", "rev-parse", "branch", "describe"}
)
SAFE_SEMICOLON_SUFFIX_GIT_SUBCOMMANDS = frozenset({"status"})
# Prefix `status` (non-verbose): leave shell cwd alone. `status -v` is rejected
# separately (it prints the patch). log/show/rev-parse/describe/branch --format/
# diff can forge commit-summary lines and are not prefix-safe.
SAFE_PREFIX_READONLY_GIT_SUBCOMMANDS = frozenset({"status"})
# Prefix commands that leave cwd alone. `commit` is allowed so multi-commit
# Shells still resolve cwd. Post-tool rewrites HEAD plus ancestors that appear
# in commit summaries (capped to loud eligible count) or &&-linked quiet
# commits. --amend is not an ancestor-eligible Shell commit (tip strip still
# runs); commits that target another repository or `git -C` directory are
# skipped entirely for cwd resolution / strip eligibility.
SAFE_PREFIX_GIT_SUBCOMMANDS = frozenset(
    {"add", "rm", "mv", "commit"}
) | SAFE_PREFIX_READONLY_GIT_SUBCOMMANDS
SAFE_SUFFIX_SHELL_OPERATORS = frozenset({"&&", ";"})
SAFE_QUIET_SUFFIX_SHELL_OPERATORS = frozenset({"&&"})
GIT_REPOSITORY_SELECTOR_OPTIONS = frozenset(
    {"--git-dir", "--work-tree", "--namespace"}
)
GIT_REPOSITORY_SELECTOR_NAMES = frozenset(
    {"GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_NAMESPACE"}
)
GIT_REPOSITORY_SELECTOR_ENVIRONMENTS = tuple(
    f"{name}=" for name in GIT_REPOSITORY_SELECTOR_NAMES
)
GIT_DRY_RUN_LONG_OPTIONS = (
    "--dry-run",
    "--short",
    "--porcelain",
    "--long",
    "--null",
)
DIRECTORY_STACK_OFFSET_RE = re.compile(r"^[+-]\d+$")
ENV_ASSIGNMENT_RE = re.compile(r"^[\w]+=")
SUDO_PRESERVE_ENV_RE = re.compile(r"^--preserve-env(?:=.*)?$")
# sudo options that take a separate argv word (or --opt=value).
SUDO_LONG_OPTIONS_WITH_ARG = frozenset(
    {
        "--user",
        "--group",
        "--host",
        "--prompt",
        "--close-from",
        "--chdir",
        "--chroot",
        "--command-timeout",
        "--other-user",
    }
)
SUDO_SHORT_OPTIONS_WITH_ARG = frozenset(
    {"-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"}
)
GIT_COMMITTER_ENV_KEYS = (
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_COMMITTER_DATE",
)
GIT_AUTHOR_ENV_KEYS = (
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_DATE",
)
AMEND_COMMIT_ARGS = ("commit", "--amend", "--only", "-F", "-")
# Backup if pinentry-mode=error still blocks (GUI pinentry, ssh askpass).
AMEND_SIGNED_TIMEOUT_SECONDS = 5.0
ANCESTOR_WALK_LIMIT = 32
# <<-TAG allows a tab-indented closer; <<TAG requires the closer at column 0.
# Capture whitespace after << / <<- so rewrite can preserve it.
SHELL_HEREDOC_RE = re.compile(
    r"<<"
    r"(?:"
    r"-(?P<ws_dash>[ \t]*)(?P<q_dash>['\"]?)(?P<tag_dash>[A-Za-z_][A-Za-z0-9_]*)(?P=q_dash)"
    r"[ \t]*\r?\n(?P<body_dash>.*?)\r?\n(?P<indent>\t*)(?P=tag_dash)"
    r"|"
    r"(?P<ws>[ \t]*)(?P<quote>['\"]?)(?P<tag>[A-Za-z_][A-Za-z0-9_]*)(?P=quote)"
    r"[ \t]*\r?\n(?P<body>.*?)\r?\n(?P=tag)"
    r")"
    r"(?=[ \t]*(?:\r?\n|$))",
    re.DOTALL,
)
# Double-quote parse keeps \$ / \` distinct from bare $ / ` across strip+re-encode.
_DOUBLE_QUOTE_ESCAPED_DOLLAR = "\ufdd0"
_DOUBLE_QUOTE_ESCAPED_BACKTICK = "\ufdd1"
# Bare `-m` must not match the `-m` inside `--message` (lookbehind).
# Glued `-mfoo` is a message value; `-m"foo"` / `-m$'foo'` stay unglued.
# `--m` / `--mes` / … are unique abbreviations of `--message` (not `--no-message`).
GIT_COMMIT_MESSAGE_FLAG_RE = re.compile(
    r"(?:--m(?:e(?:s(?:s(?:a(?:g(?:e)?)?)?)?)?)?(?:=|[ \t]+)|(?<![A-Za-z0-9-])-m[ \t]+|(?<![A-Za-z0-9-])-m)"
)
_ANSI_C_SIMPLE_ESCAPES = {
    "a": "\a",
    "b": "\b",
    "e": "\x1b",
    "E": "\x1b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
    "v": "\v",
    "\\": "\\",
    "'": "'",
    '"': '"',
    "?": "?",
}


def _heredoc_body_span(match: re.Match[str]) -> tuple[int, int]:
    if match.group("body_dash") is not None:
        return match.start("body_dash"), match.end("body_dash")
    return match.start("body"), match.end("body")


def _advance_shell_quote_index(
    text: str,
    index: int,
    in_single: bool,
    in_double: bool,
    in_ansi_c: bool,
) -> tuple[int, bool, bool, bool]:
    """Consume one character or escape pair. Return (next_index, single, double, ansi_c)."""
    char = text[index]
    if in_ansi_c:
        if char == "\\" and index + 1 < len(text):
            return index + 2, in_single, in_double, True
        if char == "'":
            return index + 1, False, in_double, False
        return index + 1, in_single, in_double, True
    if char == "\\" and not in_single and index + 1 < len(text):
        return index + 2, in_single, in_double, False
    if (
        char == "$"
        and not in_single
        and not in_double
        and index + 1 < len(text)
        and text[index + 1] == "'"
    ):
        return index + 2, False, in_double, True
    if char == "'" and not in_double:
        return index + 1, not in_single, in_double, False
    if char == '"' and not in_single:
        return index + 1, in_single, not in_double, False
    return index + 1, in_single, in_double, False


def shell_position_is_inside_quotes(text: str, position: int) -> bool:
    in_single = False
    in_double = False
    in_ansi_c = False
    index = 0
    while index < position:
        index, in_single, in_double, in_ansi_c = _advance_shell_quote_index(
            text, index, in_single, in_double, in_ansi_c
        )
    return in_ansi_c or in_single or in_double


def shell_position_is_inside_heredoc_body(text: str, position: int) -> bool:
    return any(
        start <= position < end
        for start, end in (
            _heredoc_body_span(match) for match in SHELL_HEREDOC_RE.finditer(text)
        )
    )


def append_after_dropping_shell_flag(
    pieces: list[str], prefix: str, following: str
) -> None:
    """Append text left of a removed flag; keep one space before a glued token.

    Trims spaces that only separated the removed flag. If ``following`` starts a
    glued token (non-whitespace), ensure one separating space — attaching it to
    ``prefix`` when non-empty after trim, otherwise to the previous piece.
    """
    trimmed = prefix.rstrip(" \t")
    needs_sep = bool(following) and following not in " \t\r\n"
    if trimmed:
        pieces.append(trimmed + (" " if needs_sep else ""))
        return
    if not needs_sep:
        return
    if pieces:
        pieces[-1] = pieces[-1].rstrip(" \t") + " "
    else:
        pieces.append(" ")


def strip_agent_trailer_flags_from_command(command: str) -> str:
    """Drop unquoted agent --trailer flags on git-commit statements only."""
    pieces: list[str] = []
    index = 0
    for match in AGENT_TRAILER_FLAG_RE.finditer(command):
        if match.start() < index:
            continue
        keep = (
            shell_position_is_inside_quotes(command, match.start())
            or shell_position_is_inside_heredoc_body(command, match.start())
            or not last_statement_tokens_are_git_commit(command[: match.start()])
        )
        if keep:
            pieces.append(command[index : match.start()])
            pieces.append(match.group(0))
            index = match.end()
            continue
        append_after_dropping_shell_flag(
            pieces,
            command[index : match.start()],
            command[match.end() : match.end() + 1],
        )
        index = match.end()
    pieces.append(command[index:])
    return "".join(pieces)


def _heredoc_match_parts(
    match: re.Match[str],
) -> tuple[str, str, str, str, str, str]:
    """Return (dash, ws, quote, tag, body, indent)."""
    if match.group("tag_dash") is not None:
        return (
            "-",
            match.group("ws_dash") or "",
            match.group("q_dash") or "",
            match.group("tag_dash"),
            match.group("body_dash"),
            match.group("indent") or "",
        )
    return (
        "",
        match.group("ws") or "",
        match.group("quote") or "",
        match.group("tag"),
        match.group("body"),
        "",
    )


def stub_complete_heredocs(text: str) -> str:
    def stub(match: re.Match[str]) -> str:
        dash, ws, quote, tag, _body, _indent = _heredoc_match_parts(match)
        return f"<<{dash}{ws}{quote}{tag}{quote}"

    return SHELL_HEREDOC_RE.sub(stub, text)


def close_open_quotes(text: str) -> str:
    in_single = False
    in_double = False
    in_ansi_c = False
    index = 0
    while index < len(text):
        index, in_single, in_double, in_ansi_c = _advance_shell_quote_index(
            text, index, in_single, in_double, in_ansi_c
        )
    if in_double:
        text += '"'
    if in_single or in_ansi_c:
        text += "'"
    return text


def last_statement_tokens_are_git_commit(prefix: str) -> bool:
    closed = close_open_quotes(stub_complete_heredocs(prefix))
    tokens = shell_tokens(closed)
    if not tokens:
        return False
    statements = split_shell_statements(tokens)
    if not statements:
        return False
    last, _following = statements[-1]
    return tokens_are_git_commit_command(last)


def rewrite_shell_heredoc_bodies_stripping_agent_coauthor(command: str) -> str:
    """Strip trailers inside HEREDOC bodies that belong to a git-commit statement."""

    def replace_heredoc(match: re.Match[str]) -> str:
        if not last_statement_tokens_are_git_commit(command[: match.start()]):
            return match.group(0)
        dash, ws, quote, tag, body, indent = _heredoc_match_parts(match)
        cleaned_body = commit_message_after_stripping_agent_coauthor(body)
        if cleaned_body == body:
            return match.group(0)
        # Body from splitlines(keepends=True) usually already ends with \n;
        # do not insert another before the closer.
        closer = (
            f"{cleaned_body}{indent}{tag}"
            if cleaned_body.endswith("\n")
            else f"{cleaned_body}\n{indent}{tag}"
        )
        return f"<<{dash}{ws}{quote}{tag}{quote}\n{closer}"

    return SHELL_HEREDOC_RE.sub(replace_heredoc, command)


_HEX_DIGITS = "0123456789abcdefABCDEF"


def _take_hex_digits(raw: str, start: int, maximum: int) -> tuple[str, int]:
    cursor = start
    digits: list[str] = []
    while (
        cursor < len(raw)
        and len(digits) < maximum
        and raw[cursor] in _HEX_DIGITS
    ):
        digits.append(raw[cursor])
        cursor += 1
    return "".join(digits), cursor


def _utf8_bytes_for_ansi_c_code_point(code_point: int) -> bytes:
    """UTF-8 bash emits for \\u/\\U, including 5–6 byte forms up to 0x7FFFFFFF."""
    if code_point < 0 or code_point > 0x7FFFFFFF:
        return b""
    if code_point <= 0x7F:
        return bytes((code_point,))
    for max_code_point, lead, follow_count in (
        (0x7FF, 0xC0, 1),
        (0xFFFF, 0xE0, 2),
        (0x1FFFFF, 0xF0, 3),
        (0x3FFFFFF, 0xF8, 4),
        (0x7FFFFFFF, 0xFC, 5),
    ):
        if code_point <= max_code_point:
            follow: list[int] = []
            value = code_point
            for _ in range(follow_count):
                follow.append(0x80 | (value & 0x3F))
                value >>= 6
            return bytes((lead | value, *reversed(follow)))
    raise AssertionError(f"unreachable ANSI-C code point: {code_point:#x}")


def _chr_from_hex_digits(digits: str) -> str:
    code_point = int(digits, 16)
    try:
        return chr(code_point)
    except (ValueError, OverflowError):
        return _utf8_bytes_for_ansi_c_code_point(code_point).decode("latin-1")


def _consume_hex_escape(
    pieces: list[str], raw: str, index: int, letter: str, maximum: int
) -> int:
    hex_digits, cursor = _take_hex_digits(raw, index + 2, maximum)
    if not hex_digits:
        pieces.append("\\" + letter)
        return index + 2
    pieces.append(_chr_from_hex_digits(hex_digits))
    return cursor


_HEX_ESCAPE_WIDTH = {"x": 2, "u": 4, "U": 8}


def decode_ansi_c_quoted_body(raw: str) -> str | None:
    """Decode a $'...' body.

    Empty \\x / \\u / \\U stay as those two characters. Out-of-range \\u / \\U
    match bash (extended UTF-8 bytes, or empty at 0x80000000+). Octal \\nnn is
    an 8-bit byte (bash; ``\\777`` → 0xFF, ``\\400`` → NUL). None if a
    backslash is dangling or a \\c sequence is truncated.
    """
    pieces: list[str] = []
    index = 0
    while index < len(raw):
        char = raw[index]
        if char != "\\":
            pieces.append(char)
            index += 1
            continue
        if index + 1 >= len(raw):
            return None
        escape = raw[index + 1]
        simple = _ANSI_C_SIMPLE_ESCAPES.get(escape)
        if simple is not None:
            pieces.append(simple)
            index += 2
            continue
        width = _HEX_ESCAPE_WIDTH.get(escape)
        if width is not None:
            index = _consume_hex_escape(pieces, raw, index, escape, width)
            continue
        if escape == "c":
            if index + 2 >= len(raw):
                return None
            control = raw[index + 2]
            consumed = 3
            if control == "\\" and index + 3 < len(raw):
                control = raw[index + 3]
                consumed = 4
            elif control == "\\":
                return None
            if control == "?":
                pieces.append("\x7f")
            else:
                pieces.append(chr(ord(control) & 0x1F))
            index += consumed
            continue
        if escape in "01234567":
            oct_digits = [escape]
            cursor = index + 2
            while (
                cursor < len(raw)
                and len(oct_digits) < 3
                and raw[cursor] in "01234567"
            ):
                oct_digits.append(raw[cursor])
                cursor += 1
            pieces.append(chr(int("".join(oct_digits), 8) & 0xFF))
            index = cursor
            continue
        pieces.append(escape)
        index += 2
    return "".join(pieces)


def parse_unquoted_commit_message_at(
    text: str, start: int
) -> tuple[str, str, int] | None:
    """Parse an unquoted -m / --message value. Opener is empty."""
    if start >= len(text) or text[start] in " \t\r\n":
        return None
    if text.startswith("$'", start) or text[start] in "'\"":
        return None
    index = start
    chars: list[str] = []
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text):
            chars.append(text[index + 1])
            index += 2
            continue
        if char in " \t\r\n;|&()<>\"'":
            break
        chars.append(char)
        index += 1
    if index == start:
        return None
    return ("", "".join(chars), index)


def encode_unquoted_commit_message(message: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9._+-]+", message):
        return message
    return encode_shell_quoted_commit_message("'", message)


def encode_shell_quoted_commit_message(opener: str, message: str) -> str:
    if opener == "":
        return encode_unquoted_commit_message(message)
    if opener == "$'":
        escaped = (
            message.replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\t", "\\t")
            .replace("\r", "\\r")
        )
        return f"$'{escaped}'"
    if opener == "'":
        return "'" + message.replace("'", "'\\''") + "'"
    escaped_double: list[str] = []
    for char in message:
        if char == _DOUBLE_QUOTE_ESCAPED_DOLLAR:
            escaped_double.append("\\$")
            continue
        if char == _DOUBLE_QUOTE_ESCAPED_BACKTICK:
            escaped_double.append("\\`")
            continue
        # Bare $ / ` stay unescaped so shell expansion matches the original.
        if char in '\\"':
            escaped_double.append("\\")
        escaped_double.append(char)
    return '"' + "".join(escaped_double) + '"'


def parse_shell_quoted_commit_message_at(
    text: str, start: int
) -> tuple[str, str, int] | None:
    """Parse a shell-quoted -m value at start. Return (opener, message, end)."""
    if start >= len(text):
        return None
    if text.startswith("$'", start):
        index = start + 2
        raw_chars: list[str] = []
        while index < len(text):
            char = text[index]
            if char == "\\" and index + 1 < len(text):
                raw_chars.append(char)
                raw_chars.append(text[index + 1])
                index += 2
                continue
            if char == "'":
                decoded = decode_ansi_c_quoted_body("".join(raw_chars))
                if decoded is None:
                    return None
                return ("$'", decoded, index + 1)
            raw_chars.append(char)
            index += 1
        return None
    if text[start] == "'":
        index = start + 1
        chars: list[str] = []
        while index < len(text):
            if text[index] == "'":
                return ("'", "".join(chars), index + 1)
            chars.append(text[index])
            index += 1
        return None
    if text[start] == '"':
        index = start + 1
        chars: list[str] = []
        while index < len(text):
            char = text[index]
            if char == "\\" and index + 1 < len(text):
                nxt = text[index + 1]
                if nxt == "$":
                    chars.append(_DOUBLE_QUOTE_ESCAPED_DOLLAR)
                elif nxt == "`":
                    chars.append(_DOUBLE_QUOTE_ESCAPED_BACKTICK)
                elif nxt in '"\\\n':
                    chars.append(nxt)
                else:
                    chars.append("\\")
                    chars.append(nxt)
                index += 2
                continue
            if char == '"':
                return ('"', "".join(chars), index + 1)
            chars.append(char)
            index += 1
        return None
    return None


def git_commit_statement_index(command: str, position: int) -> int | None:
    """Index of the open statement at position (prefix tokens only)."""
    closed = close_open_quotes(stub_complete_heredocs(command[:position]))
    tokens = shell_tokens(closed)
    if not tokens:
        return None
    statements = split_shell_statements(tokens)
    if not statements:
        return None
    return len(statements) - 1


def git_commit_has_noninteractive_message_source(tokens: list[str]) -> bool:
    """True when commit already has a message without opening an editor.

    ``-F`` / ``-C`` / ``--file`` / ``--reuse-message`` / ``--fixup`` /
    ``--squash`` supply a message non-interactively. ``-c`` / ``-t`` /
    ``--reedit-message`` / ``--template`` open an editor, so they do not
    qualify. ``--amend`` alone also opens an editor unless ``--no-edit``.
    ``-m`` cannot be combined with ``-c`` / ``-C``.
    """
    indices = git_command_indices(tokens)
    if indices is None:
        return False
    _, commit_index = indices
    for token in tokens[commit_index + 1 :]:
        if token == "--":
            break
        if token in {"-F", "-C"}:
            return True
        if not token.startswith("--"):
            continue
        name = token.split("=", maxsplit=1)[0]
        for full, minimum in (
            ("--file", 4),
            ("--fixup", 4),
            ("--squash", 4),
            # --reu uniquely matches --reuse-message (--ree → --reedit-message).
            ("--reuse-message", 5),
        ):
            if len(name) >= minimum and full.startswith(name):
                return True
    return False


def git_commit_invokes_message_editor(tokens: list[str]) -> bool:
    """True for --amend / -c / --reedit-message (editor unless --no-edit)."""
    indices = git_command_indices(tokens)
    if indices is None:
        return False
    _, commit_index = indices
    if git_commit_is_amend(tokens, commit_index):
        return True
    for token in tokens[commit_index + 1 :]:
        if token == "--":
            break
        if token == "-c":
            return True
        if not token.startswith("--"):
            continue
        name = token.split("=", maxsplit=1)[0]
        # --ree uniquely matches --reedit-message (--reu → --reuse-message).
        if len(name) >= 5 and "--reedit-message".startswith(name):
            return True
    return False


def git_commit_has_no_edit(tokens: list[str]) -> bool:
    indices = git_command_indices(tokens)
    if indices is None:
        return False
    _, commit_index = indices
    for token in tokens[commit_index + 1 :]:
        if token == "--":
            break
        if not token.startswith("--"):
            continue
        name = token.split("=", maxsplit=1)[0]
        # --no-e uniquely matches --no-edit among commit options.
        if len(name) >= 6 and "--no-edit".startswith(name):
            return True
    return False


def append_flag_token_after_dropping_shell_flag(
    pieces: list[str], prefix: str, following: str, flag_token: str
) -> None:
    """Drop a flag and insert ``flag_token`` (e.g. ``-m ''`` or ``--no-edit``)."""
    trimmed = prefix.rstrip(" \t")
    needs_sep = bool(following) and following not in " \t\r\n"
    extra = " " if needs_sep else ""
    if trimmed:
        pieces.append(trimmed + " " + flag_token + extra)
        return
    if pieces:
        pieces[-1] = pieces[-1].rstrip(" \t") + " " + flag_token + extra
        return
    pieces.append(flag_token + extra)


def append_empty_quoted_commit_message_flag(
    pieces: list[str], prefix: str, following: str
) -> None:
    """Insert ``-m ''`` so a stripped agent-only message stays non-interactive."""
    append_flag_token_after_dropping_shell_flag(pieces, prefix, following, "-m ''")


def rewrite_git_commit_messages_stripping_agent_coauthor(command: str) -> str:
    """Strip trailers in -m / --message values on a git-commit statement.

    Handles quoted values, ANSI-C ``$'…'``, and unquoted / glued forms (``-mfoo``).
    Agent-only flags drop when another non-interactive message source remains;
    otherwise they become ``-m ''`` so ``git commit`` does not open an editor.
    ``--amend`` / ``-c`` / ``--reedit-message`` keep the reused message via
    ``--no-edit`` when the only ``-m`` was agent-only (``-m`` cannot combine
    with ``-c``, and bare ``--amend`` / ``-c`` would open an editor).
    """
    planned: list[tuple[re.Match[str], str, int, str, str]] = []
    index = 0
    for flag in GIT_COMMIT_MESSAGE_FLAG_RE.finditer(command):
        if flag.start() < index:
            continue
        if (
            shell_position_is_inside_quotes(command, flag.start())
            or shell_position_is_inside_heredoc_body(command, flag.start())
            or not last_statement_tokens_are_git_commit(command[: flag.start()])
        ):
            index = flag.end()
            continue
        parsed = parse_shell_quoted_commit_message_at(command, flag.end())
        if parsed is None:
            parsed = parse_unquoted_commit_message_at(command, flag.end())
        if parsed is None:
            index = flag.end()
            continue
        opener, message, end = parsed
        stripped_lead = message.lstrip()
        if stripped_lead.startswith("$(") or stripped_lead.startswith("`"):
            index = end
            continue
        cleaned = commit_message_after_stripping_agent_coauthor(message)
        statement = git_commit_statement_index(command, flag.start())
        if statement is None:
            index = end
            continue
        action = "keep"
        if cleaned != message:
            action = "empty" if not cleaned.strip() else "rewrite"
        planned.append((flag, opener, end, cleaned, action))
        index = end

    empty_by_statement: dict[int, list[int]] = {}
    kept_by_statement: set[int] = set()
    for item_index, (flag, _opener, _end, _cleaned, action) in enumerate(planned):
        statement = git_commit_statement_index(command, flag.start())
        if statement is None:
            continue
        if action == "empty":
            empty_by_statement.setdefault(statement, []).append(item_index)
        else:
            kept_by_statement.add(statement)

    empty_keep: set[int] = set()
    insert_no_edit: set[int] = set()
    closed_command = close_open_quotes(stub_complete_heredocs(command))
    tokens = shell_tokens(closed_command)
    statements = split_shell_statements(tokens) if tokens else None
    for statement, item_indices in empty_by_statement.items():
        if statement in kept_by_statement:
            continue
        statement_tokens = (
            statements[statement][0]
            if statements is not None and statement < len(statements)
            else None
        )
        if statement_tokens is not None and git_commit_has_noninteractive_message_source(
            statement_tokens
        ):
            continue
        if statement_tokens is not None and git_commit_invokes_message_editor(
            statement_tokens
        ):
            if not git_commit_has_no_edit(statement_tokens):
                insert_no_edit.add(statement)
            continue
        empty_keep.add(item_indices[0])

    pieces: list[str] = []
    index = 0
    for item_index, (flag, opener, end, cleaned, action) in enumerate(planned):
        pieces.append(command[index : flag.start()])
        if action == "keep":
            pieces.append(command[flag.start() : end])
        elif action == "rewrite":
            pieces.append(
                flag.group(0) + encode_shell_quoted_commit_message(opener, cleaned)
            )
        elif item_index in empty_keep:
            prefix = pieces.pop()
            append_empty_quoted_commit_message_flag(
                pieces, prefix, command[end : end + 1]
            )
        else:
            prefix = pieces.pop()
            statement = git_commit_statement_index(command, flag.start())
            if statement in insert_no_edit:
                append_flag_token_after_dropping_shell_flag(
                    pieces, prefix, command[end : end + 1], "--no-edit"
                )
                insert_no_edit.discard(statement)
            else:
                append_after_dropping_shell_flag(
                    pieces, prefix, command[end : end + 1]
                )
        index = end
    pieces.append(command[index:])
    return "".join(pieces)


def strip_agent_from_shell_command(command: str) -> str:
    """Strip agent coauthor injection from a git-commit Shell command."""
    without_flags = strip_agent_trailer_flags_from_command(command)
    without_heredocs = rewrite_shell_heredoc_bodies_stripping_agent_coauthor(
        without_flags
    )
    return rewrite_git_commit_messages_stripping_agent_coauthor(
        without_heredocs
    )


def split_message_and_git_trailer_block(message: str) -> tuple[str, str]:
    """Split a commit message into (prefix, trailing git trailer block).

    Trailer detection is ``git interpret-trailers`` (blank line before the
    block; ``---`` in the body is not a divider). The original suffix is
    kept so remaining trailers are not reformatted. ``#`` comment lines sit
    in the block but are omitted from ``--only-trailers``, so the suffix is
    aligned by walking the message rather than a raw line count. If git
    finds no trailers or fails, the whole message is the prefix.
    """
    if not message:
        return "", ""
    proc = run_git(
        [
            "interpret-trailers",
            "--only-trailers",
            "--only-input",
            "--no-divider",
        ],
        cwd=None,
        input_text=message,
    )
    if proc.returncode != 0:
        return message, ""
    trailer_line_count = sum(
        1 for line in proc.stdout.splitlines() if line.strip()
    )
    if trailer_line_count == 0:
        return message, ""
    lines = message.splitlines(keepends=True)
    index = len(lines) - 1
    while index >= 0 and lines[index].strip() == "":
        index -= 1
    if index < 0:
        return message, ""
    remaining = trailer_line_count
    start = index + 1
    while index >= 0:
        content = lines[index].rstrip("\r\n")
        if content.strip() == "":
            break
        # Column-0 '#' comments are in the trailer region but omitted from
        # --only-trailers; leading whitespace before '#' is a continuation.
        if content.startswith("#"):
            start = index
            index -= 1
            continue
        if remaining == 0:
            break
        remaining -= 1
        start = index
        index -= 1
    if remaining != 0 or start < 0:
        return message, ""
    if start > 0 and lines[start - 1].strip() != "":
        return message, ""
    return "".join(lines[:start]), "".join(lines[start:])


def strip_agent_from_commit_message(message: str) -> str:
    """Remove agent Co-authored-by lines only from the trailing trailer block.

    An isolated ``-m`` whose entire text is agent Co-authored-by lines is
    also stripped: git does not treat a subject-only line as a trailer.
    """
    prefix, trailers = split_message_and_git_trailer_block(message)
    if trailers:
        cleaned_trailers = AGENT_LINE_RE.sub("", trailers)
        if cleaned_trailers == trailers:
            return message
        return prefix + cleaned_trailers
    nonempty = [line for line in message.splitlines() if line.strip()]
    if nonempty and all(AGENT_LINE_RE.match(line) for line in nonempty):
        return ""
    return message


def looks_like_git_commit(command: str) -> bool:
    tokens = shell_tokens(command)
    if not tokens:
        return False
    statement: list[str] = []
    for token in tokens:
        if token in SHELL_CONTROL_OPERATORS:
            if tokens_are_git_commit_command(statement):
                return True
            statement = []
            continue
        statement.append(token)
    return bool(statement) and tokens_are_git_commit_command(statement)


def unquoted_newlines_as_semicolons(command: str) -> str:
    pieces: list[str] = []
    in_single = False
    in_double = False
    in_ansi_c = False
    index = 0
    while index < len(command):
        char = command[index]
        quoted = in_ansi_c or in_single or in_double
        if char in "\r\n" and not quoted:
            pieces.append(" ; ")
            if char == "\r" and index + 1 < len(command) and command[index + 1] == "\n":
                index += 2
                continue
            index += 1
            continue
        next_index, in_single, in_double, in_ansi_c = _advance_shell_quote_index(
            command, index, in_single, in_double, in_ansi_c
        )
        pieces.append(command[index:next_index])
        index = next_index
    return "".join(pieces)


def coalesce_shell_redirection_ampersands(tokens: list[str]) -> list[str]:
    """Join `&` that shlex split out of `2>&1` / `&>file` (not background `&`)."""
    merged: list[str] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token != "&":
            merged.append(token)
            index += 1
            continue
        previous = merged[-1] if merged else None
        following = tokens[index + 1] if index + 1 < len(tokens) else None
        if (
            previous is not None
            and previous.endswith(">")
            and following is not None
            and (following.isdigit() or following == "-")
        ):
            merged[-1] = previous + "&" + following
            index += 2
            continue
        if following is not None and following.startswith(">"):
            merged.append("&" + following)
            index += 2
            continue
        merged.append(token)
        index += 1
    return merged


def shell_tokens(command: str) -> list[str] | None:
    try:
        lexer = shlex.shlex(
            unquoted_newlines_as_semicolons(command),
            posix=True,
            punctuation_chars=";&|",
        )
        lexer.whitespace_split = True
        lexer.commenters = ""
        return coalesce_shell_redirection_ampersands(list(lexer))
    except ValueError:
        return None


def skip_env_assignments(tokens: list[str], index: int) -> int:
    while index < len(tokens) and ENV_ASSIGNMENT_RE.match(tokens[index]):
        index += 1
    return index


def skip_env_command_prefix(tokens: list[str], index: int) -> int:
    if index >= len(tokens) or tokens[index] != "env":
        return index
    index += 1
    while index < len(tokens):
        token = tokens[index]
        if ENV_ASSIGNMENT_RE.match(token) or token in {
            "-i",
            "--ignore-environment",
        }:
            index += 1
            continue
        if token in {"-u", "--unset"}:
            index += 2
            continue
        if token.startswith("--unset="):
            index += 1
            continue
        break
    return index


def skip_env_prefixes(tokens: list[str], index: int = 0) -> int:
    while True:
        start = index
        index = skip_env_assignments(tokens, index)
        index = skip_env_command_prefix(tokens, index)
        index = skip_env_assignments(tokens, index)
        if index == start:
            return index


def skip_sudo_prefix(tokens: list[str], index: int) -> int:
    """Skip `sudo` and its options. Stop at the command word (or after `--`)."""
    if index >= len(tokens) or tokens[index] != "sudo":
        return index
    index += 1
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            return index + 1
        if not token.startswith("-"):
            break
        if SUDO_PRESERVE_ENV_RE.match(token):
            index += 1
            continue
        if token.startswith("--"):
            name, sep, _value = token.partition("=")
            if name in SUDO_LONG_OPTIONS_WITH_ARG:
                index += 1 if sep else 2
                continue
            index += 1
            continue
        if token in SUDO_SHORT_OPTIONS_WITH_ARG:
            index += 2
            continue
        # Flag-only short option or cluster (-n, -E, -nE, …).
        index += 1
    return index


def skip_leading_sudo_and_env_prefixes(tokens: list[str], index: int = 0) -> int:
    """Skip env prefixes, optional sudo (+ options), then env again."""
    index = skip_env_prefixes(tokens, index)
    index = skip_sudo_prefix(tokens, index)
    return skip_env_prefixes(tokens, index)


def tokens_are_git_commit_command(tokens: list[str]) -> bool:
    index = skip_leading_sudo_and_env_prefixes(tokens)
    indices = git_command_indices(tokens)
    if indices is None:
        return False
    git_index, _ = indices
    return git_index == index


def split_shell_statements(
    tokens: list[str],
) -> list[tuple[list[str], str | None]] | None:
    """Split tokens into (statement, following_operator_or_None). None if empty statement."""
    statements: list[tuple[list[str], str | None]] = []
    current: list[str] = []
    for token in tokens:
        if token in SHELL_CONTROL_OPERATORS:
            if not current:
                return None
            statements.append((current, token))
            current = []
            continue
        current.append(token)
    if current:
        statements.append((current, None))
    return statements


def statement_is_safe_commit_suffix(
    command: list[str],
    *,
    allowed_git_subcommands: frozenset[str],
    forbid_verbose_status: bool = False,
) -> bool:
    if not command:
        return False
    index = skip_leading_sudo_and_env_prefixes(command)
    if index >= len(command):
        return False
    if command[index] in {"true", ":"}:
        return index == len(command) - 1
    if command[index] != "git" and os.path.basename(command[index]) != "git":
        return False
    subcommand = git_subcommand(command[index:])
    if subcommand not in allowed_git_subcommands:
        return False
    if (
        forbid_verbose_status
        and subcommand == "status"
        and git_status_is_verbose(command[index:])
    ):
        return False
    return True


def suffix_allows_quiet_commit_strip(suffix_tokens: list[str]) -> bool:
    """Quiet commits have no summary; only && keeps a failed commit from exit 0."""
    if not suffix_tokens:
        return True
    return all(
        token not in SHELL_CONTROL_OPERATORS
        or token in SAFE_QUIET_SUFFIX_SHELL_OPERATORS
        for token in suffix_tokens
    )


def suffix_allows_post_commit_strip(suffix_tokens: list[str]) -> bool:
    """True when empty or only && / ; followed by allowed status-like commands."""
    if not suffix_tokens:
        return True
    # Suffix is stored as a leading operator plus statements, e.g. ["&&", "git", "status"].
    index = 0
    incoming = None
    if suffix_tokens[0] in SHELL_CONTROL_OPERATORS:
        if suffix_tokens[0] not in SAFE_SUFFIX_SHELL_OPERATORS:
            return False
        incoming = suffix_tokens[0]
        index = 1
    if index >= len(suffix_tokens):
        return False
    rest = split_shell_statements(suffix_tokens[index:])
    if rest is None or not rest:
        return False
    # Full git follow-ups only while every operator from the commit is `&&`.
    # After a `;`, later `&&` does not restore that (status can still run).
    reached_after_semicolon = incoming == ";"
    for statement, following in rest:
        commit_success_gated = incoming == "&&" and not reached_after_semicolon
        allowed_git = (
            SAFE_SUFFIX_GIT_SUBCOMMANDS
            if commit_success_gated
            else SAFE_SEMICOLON_SUFFIX_GIT_SUBCOMMANDS
        )
        if not statement_is_safe_commit_suffix(
            statement,
            allowed_git_subcommands=allowed_git,
            forbid_verbose_status=not commit_success_gated,
        ):
            return False
        if following is not None and following not in SAFE_SUFFIX_SHELL_OPERATORS:
            return False
        if following == ";":
            reached_after_semicolon = True
        incoming = following
    return True


def last_git_commit_command_tokens(
    command: str,
) -> tuple[list[str], list[str], list[str]] | None:
    """Last git-commit statement plus prefix/suffix tokens.

    Suffix must be empty or only safe follow-ups (`&&` plus the full read-only
    set, or `;`/`newline` plus non-verbose `git status` or `true`/`:`) so
    post-tool amend still runs. Quiet commits reject `;` suffixes here so cwd
    resolution matches quiet strip rules.
    """
    tokens = shell_tokens(command)
    if not tokens:
        return None
    while tokens and tokens[-1] == ";":
        tokens.pop()
    if not tokens or tokens[-1] in SHELL_CONTROL_OPERATORS:
        return None

    statements = split_shell_statements(tokens)
    if statements is None:
        return None

    commit_index = None
    for index, (statement, _) in enumerate(statements):
        if tokens_are_git_commit_command(statement):
            commit_index = index
    if commit_index is None:
        return None

    commit_tokens = statements[commit_index][0]
    prefix_tokens: list[str] = []
    for statement, following in statements[:commit_index]:
        prefix_tokens.extend(statement)
        if following is not None:
            prefix_tokens.append(following)

    suffix_tokens: list[str] = []
    following_commit = statements[commit_index][1]
    if following_commit is not None:
        suffix_tokens.append(following_commit)
        for statement, following in statements[commit_index + 1 :]:
            suffix_tokens.extend(statement)
            if following is not None:
                suffix_tokens.append(following)

    if not suffix_allows_post_commit_strip(suffix_tokens):
        return None
    indices = git_command_indices(commit_tokens)
    if indices is not None:
        _, commit_subcommand_index = indices
        if git_commit_is_quiet(
            commit_tokens, commit_subcommand_index
        ) and not suffix_allows_quiet_commit_strip(suffix_tokens):
            return None
    return commit_tokens, prefix_tokens, suffix_tokens


def git_binary_index(tokens: list[str]) -> int | None:
    return next(
        (
            index
            for index, token in enumerate(tokens)
            if token == "git" or os.path.basename(token) == "git"
        ),
        None,
    )


def directory_from_attached_git_c_option(token: str) -> str | None:
    """Path in `git -C/other` (no space). `-C` alone is not attached."""
    if token.startswith("-C") and len(token) > 2:
        return token[2:]
    return None


def index_after_git_global_options(tokens: list[str], git_index: int) -> int:
    index = git_index + 1
    while index < len(tokens):
        token = tokens[index]
        if token in {"-C", "-c"} or token in GIT_REPOSITORY_SELECTOR_OPTIONS:
            index += 2
            continue
        if token.startswith("-"):
            index += 1
            continue
        break
    return index


def git_command_indices(tokens: list[str]) -> tuple[int, int] | None:
    git_index = git_binary_index(tokens)
    if git_index is None:
        return None
    index = index_after_git_global_options(tokens, git_index)
    if index < len(tokens) and tokens[index] == "commit":
        return git_index, index
    return None


def git_subcommand(tokens: list[str]) -> str | None:
    git_index = git_binary_index(tokens)
    if git_index is None:
        return None
    index = index_after_git_global_options(tokens, git_index)
    if index >= len(tokens):
        return None
    return tokens[index]


def git_status_is_verbose(tokens: list[str]) -> bool:
    git_index = git_binary_index(tokens)
    if git_index is None:
        return False
    index = index_after_git_global_options(tokens, git_index)
    if index >= len(tokens) or tokens[index] != "status":
        return False
    verbose = False
    for token in tokens[index + 1 :]:
        if token == "--":
            break
        if token.startswith("--"):
            option = token.split("=", maxsplit=1)[0]
            # Unique abbreviations; last --verbose / --no-verbose wins.
            if len(option) >= 6 and "--no-verbose".startswith(option):
                verbose = False
                continue
            if len(option) >= 3 and "--verbose".startswith(option):
                verbose = True
        elif token.startswith("-") and not token.startswith("--") and "v" in token:
            verbose = True
    return verbose


def prefix_command_keeps_working_directory(command: list[str]) -> bool:
    if not command:
        return False
    index = skip_leading_sudo_and_env_prefixes(command)
    if index >= len(command):
        return False
    if command[index] in {"true", ":"}:
        return index == len(command) - 1
    if command[index] != "git" and os.path.basename(command[index]) != "git":
        return False
    subcommand = git_subcommand(command[index:])
    if subcommand == "status" and git_status_is_verbose(command[index:]):
        return False
    return subcommand in SAFE_PREFIX_GIT_SUBCOMMANDS


def git_commit_is_dry_run(tokens: list[str], commit_index: int) -> bool:
    for token in tokens[commit_index + 1 :]:
        if token == "--":
            return False
        if token.startswith("--"):
            option = token.split("=", maxsplit=1)[0]
            # Unique abbreviations are accepted by Git; require enough
            # characters so short unrelated flags are not treated as dry-run.
            if len(option) >= 4 and any(
                dry_run_option.startswith(option)
                for dry_run_option in GIT_DRY_RUN_LONG_OPTIONS
            ):
                return True
        elif token.startswith("-") and "z" in token:
            return True
    return False


def git_commit_is_quiet(tokens: list[str], commit_index: int) -> bool:
    for token in tokens[commit_index + 1 :]:
        if token == "--":
            return False
        if token.startswith("--"):
            option = token.split("=", maxsplit=1)[0]
            # Unique abbreviations Git accepts (e.g. --q, --qui).
            if len(option) >= 3 and "--quiet".startswith(option):
                return True
            continue
        if token.startswith("-") and "q" in token:
            return True
    return False


def git_commit_is_amend(tokens: list[str], commit_index: int) -> bool:
    for token in tokens[commit_index + 1 :]:
        if token == "--":
            return False
        if token.startswith("--"):
            option = token.split("=", maxsplit=1)[0]
            # Unique abbreviations Git accepts (e.g. --amen); require enough
            # characters so short unrelated flags are not treated as amend.
            if len(option) >= 4 and "--amend".startswith(option):
                return True
    return False


def git_command_selects_another_repository(
    tokens: list[str], commit_index: int
) -> bool:
    for token in tokens[:commit_index]:
        if token.startswith(GIT_REPOSITORY_SELECTOR_ENVIRONMENTS):
            return True
        option = token.split("=", maxsplit=1)[0]
        if option in GIT_REPOSITORY_SELECTOR_OPTIONS:
            return True
    return False


def resolve_literal_shell_directory(base: str, path: str) -> str | None:
    if (
        not path
        or path == "-"
        or DIRECTORY_STACK_OFFSET_RE.match(path)
        or path.startswith("~")
        or "$" in path
        or "`" in path
    ):
        return None
    if os.path.isabs(path):
        return os.path.normpath(path)
    return os.path.normpath(os.path.join(os.path.abspath(base), path))


def prefix_command_selects_another_repository(tokens: list[str]) -> bool:
    for token in tokens:
        if token.startswith(GIT_REPOSITORY_SELECTOR_ENVIRONMENTS):
            return True
    if tokens and tokens[0] == "export":
        for token in tokens[1:]:
            name = token.split("=", maxsplit=1)[0]
            if name in GIT_REPOSITORY_SELECTOR_NAMES:
                return True
    return False


def working_directory_after_prefix_command(
    base: str, command: list[str], operator: str
) -> str | None:
    if not command or prefix_command_selects_another_repository(command):
        return None
    if operator in {"||", "|", "&", "|&"}:
        return None
    rest = command[skip_leading_sudo_and_env_prefixes(command) :]
    if not rest:
        return None
    if rest[0] in DIRECTORY_CHANGING_BUILTINS:
        if operator not in CD_DIRECTORY_OPERATORS or len(rest) != 2:
            return None
        return resolve_literal_shell_directory(base, rest[1])
    if rest[0] == "popd":
        return None
    if prefix_command_keeps_working_directory(command):
        return base
    return None


def working_directory_after_prefix(
    base: str, prefix_tokens: list[str]
) -> str | None:
    command: list[str] = []
    for token in prefix_tokens:
        if token in SHELL_CONTROL_OPERATORS:
            if command:
                base = working_directory_after_prefix_command(base, command, token)
                if base is None:
                    return None
                command = []
            continue
        command.append(token)
    if command:
        return None
    return base


def working_directory_from_git_minus_c_options(
    base: str, tokens: list[str], stop_index: int
) -> str | None:
    index = 0
    while index < stop_index:
        attached = directory_from_attached_git_c_option(tokens[index])
        if attached is not None:
            base = resolve_literal_shell_directory(base, attached)
            if base is None:
                return None
            index += 1
            continue
        if tokens[index] != "-C":
            index += 1
            continue
        if index + 1 >= stop_index:
            return None
        base = resolve_literal_shell_directory(base, tokens[index + 1])
        if base is None:
            return None
        index += 2
    return base


def git_working_directory(
    payload: dict[str, Any],
    command: str,
    tool_input: dict[str, Any] | None = None,
) -> str | None:
    working_directory = None
    if tool_input:
        raw_working_directory = tool_input.get("working_directory")
        if isinstance(raw_working_directory, str) and raw_working_directory:
            working_directory = raw_working_directory
    cwd = payload.get("cwd")
    if working_directory:
        base = working_directory
    elif isinstance(cwd, str) and cwd:
        base = cwd
    else:
        return None

    command_tokens = last_git_commit_command_tokens(command)
    if command_tokens is None:
        return None
    commit_tokens, prefix_tokens, _suffix_tokens = command_tokens
    if prefix_tokens:
        base = working_directory_after_prefix(base, prefix_tokens)
        if base is None:
            return None

    indices = git_command_indices(commit_tokens)
    if indices is None:
        return None
    _, commit_index = indices
    if (
        git_commit_is_dry_run(commit_tokens, commit_index)
        or git_command_selects_another_repository(commit_tokens, commit_index)
    ):
        return None

    return working_directory_from_git_minus_c_options(base, commit_tokens, commit_index)


def env_without_git_repository_selectors(
    env: dict[str, str] | None = None,
) -> dict[str, str]:
    """Copy env (or os.environ) without GIT_DIR / work-tree selectors."""
    cleaned = (os.environ if env is None else env).copy()
    for key in GIT_REPOSITORY_SELECTOR_NAMES:
        cleaned.pop(key, None)
    return cleaned


def emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, separators=(",", ":")))


def report_hook_failure(message: str) -> None:
    sys.stderr.write(f"strip-agent-coauthor: {message}\n")


def handle_pre_tool_use(payload: dict[str, Any]) -> None:
    tool_name = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input")
    if tool_name != "Shell" or not isinstance(tool_input, dict):
        emit({"permission": "allow"})
        return

    command = tool_input.get("command")
    if not isinstance(command, str) or not looks_like_git_commit(command):
        emit({"permission": "allow"})
        return

    cleaned = strip_agent_from_shell_command(command)
    if cleaned == command:
        emit({"permission": "allow"})
        return

    updated = dict(tool_input)
    updated["command"] = cleaned
    emit({"permission": "allow", "updated_input": updated})


def run_git(
    args: list[str],
    *,
    cwd: str | None,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
    timeout: float | None = None,
) -> subprocess.CompletedProcess[str]:
    kwargs: dict[str, Any] = {
        "args": ["git", *args],
        "text": True,
        "env": env_without_git_repository_selectors(env),
    }
    if cwd:
        kwargs["cwd"] = cwd
    if timeout is None:
        kwargs["check"] = False
        kwargs["capture_output"] = True
        if input_text is not None:
            kwargs["input"] = input_text
        return subprocess.run(**kwargs)

    kwargs["stdout"] = subprocess.PIPE
    kwargs["stderr"] = subprocess.PIPE
    kwargs["start_new_session"] = True
    if input_text is not None:
        kwargs["stdin"] = subprocess.PIPE
    proc = subprocess.Popen(**kwargs)
    try:
        stdout, stderr = proc.communicate(input=input_text, timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        stdout, stderr = proc.communicate()
        return subprocess.CompletedProcess(
            ["git", *args],
            -1,
            stdout or "",
            (stderr or "") + "strip-agent-coauthor: signed amend timed out\n",
        )
    return subprocess.CompletedProcess(
        ["git", *args], proc.returncode, stdout, stderr
    )


def rev_has_agent_coauthor(cwd: str | None, rev: str) -> bool:
    proc = run_git(["log", "-1", "--format=%B", rev], cwd=cwd)
    if proc.returncode != 0:
        return False
    _, trailers = split_message_and_git_trailer_block(proc.stdout)
    return bool(trailers) and AGENT_LINE_RE.search(trailers) is not None


def commit_parent_count(cwd: str | None, rev: str) -> int | None:
    proc = run_git(["log", "-1", "--format=%P", rev], cwd=cwd)
    if proc.returncode != 0:
        return None
    parents = proc.stdout.strip()
    if not parents:
        return 0
    return len(parents.split())


def git_committer_identity_is_configured(cwd: str | None) -> bool:
    name = run_git(["config", "user.name"], cwd=cwd)
    email = run_git(["config", "user.email"], cwd=cwd)
    return bool(name.stdout.strip()) and bool(email.stdout.strip())


def env_for_tip_amend(cwd: str | None) -> dict[str, str]:
    """Drop hook-env author/committer identity. Amend keeps the tip author without --reset-author.

    When user.name/email are unset, reuse the tip committer (same as rewrite).
    """
    env = env_without_git_repository_selectors()
    for key in (*GIT_AUTHOR_ENV_KEYS, *GIT_COMMITTER_ENV_KEYS):
        env.pop(key, None)
    if git_committer_identity_is_configured(cwd):
        return env
    proc = run_git(["log", "-1", "--format=%cn%n%ce"], cwd=cwd)
    if proc.returncode != 0:
        return env
    lines = proc.stdout.splitlines()
    if len(lines) < 2:
        return env
    env["GIT_COMMITTER_NAME"] = lines[0]
    env["GIT_COMMITTER_EMAIL"] = lines[1]
    return env


def env_for_noninteractive_signed_amend(cwd: str | None) -> dict[str, str]:
    env = env_for_tip_amend(cwd)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["SSH_ASKPASS_REQUIRE"] = "never"
    return env


def commit_gpg_sign_is_enabled(cwd: str | None) -> bool:
    proc = run_git(["config", "--bool", "--get", "commit.gpgsign"], cwd=cwd)
    return proc.returncode == 0 and proc.stdout.strip() == "true"


def tip_commit_is_signed(cwd: str | None) -> bool:
    return commit_object_is_signed(cwd, "HEAD")


def commit_object_is_signed(cwd: str | None, rev: str) -> bool:
    """True when the commit headers include a gpgsig (OpenPGP or SSH)."""
    proc = run_git(["cat-file", "-p", rev], cwd=cwd)
    if proc.returncode != 0:
        return False
    header = proc.stdout.split("\n\n", 1)[0]
    return any(line.startswith("gpgsig") for line in header.splitlines())


def should_try_signed_amend(cwd: str | None) -> bool:
    return commit_gpg_sign_is_enabled(cwd) or tip_commit_is_signed(cwd)


def should_try_signed_rewrite_of_commit(cwd: str | None, rev: str) -> bool:
    return commit_gpg_sign_is_enabled(cwd) or commit_object_is_signed(cwd, rev)


def configured_gpg_program(cwd: str | None) -> str:
    proc = run_git(["config", "--get", "gpg.program"], cwd=cwd)
    program = proc.stdout.strip() if proc.returncode == 0 else ""
    return program or "gpg"


def gpg_pinentry_error_wrapper_path(cwd: str | None) -> str:
    """Wrap gpg.program with --pinentry-mode=error so a missing passphrase fails fast."""
    program = configured_gpg_program(cwd)
    fd, path = tempfile.mkstemp(prefix="strip-agent-gpg-", suffix=".sh")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            fd = -1
            handle.write(
                "#!/bin/sh\n"
                f"exec {shlex.quote(program)} --pinentry-mode=error \"$@\"\n"
            )
        os.chmod(path, 0o755)
        return path
    except Exception:
        if fd >= 0:
            os.close(fd)
        unlink_quietly(path)
        raise


def unlink_quietly(path: str | None) -> None:
    if not path:
        return
    try:
        os.unlink(path)
    except OSError:
        pass


def git_index_lock_path(cwd: str | None) -> str | None:
    if not cwd:
        return None
    proc = run_git(["rev-parse", "--git-path", "index.lock"], cwd=cwd)
    if proc.returncode != 0:
        return None
    lock_path = proc.stdout.strip()
    if not lock_path:
        return None
    if not os.path.isabs(lock_path):
        lock_path = os.path.join(cwd, lock_path)
    return lock_path


def clear_stale_git_index_lock(cwd: str | None, *, existed_before: bool = False) -> None:
    if existed_before:
        return
    unlink_quietly(git_index_lock_path(cwd))


def try_sign_tip_with_message(cwd: str | None, message: str) -> bool:
    """Best-effort signed amend of HEAD to message. False if signing fails."""
    wrapper = None
    try:
        lock_path = git_index_lock_path(cwd)
        lock_existed_before = bool(lock_path and os.path.exists(lock_path))
        wrapper = gpg_pinentry_error_wrapper_path(cwd)
        signed = run_git(
            [
                "-c",
                "commit.gpgsign=true",
                "-c",
                f"gpg.program={wrapper}",
                *AMEND_COMMIT_ARGS,
            ],
            cwd=cwd,
            input_text=message,
            env=env_for_noninteractive_signed_amend(cwd),
            timeout=AMEND_SIGNED_TIMEOUT_SECONDS,
        )
        if signed.returncode == 0:
            return True
        if signed.returncode == -1:
            clear_stale_git_index_lock(cwd, existed_before=lock_existed_before)
        return False
    finally:
        unlink_quietly(wrapper)


def commit_message_after_stripping_agent_coauthor(body: str) -> str:
    """Keep body bytes when strip is a no-op; otherwise normalize trailing newlines."""
    stripped = strip_agent_from_commit_message(body)
    if stripped == body:
        return body
    return stripped.rstrip() + "\n"


def amend_tip_stripping_agent_coauthor(cwd: str | None) -> bool:
    proc = run_git(["log", "-1", "--format=%B"], cwd=cwd)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        report_hook_failure(
            "git log -1 failed" + (f": {detail}" if detail else "")
        )
        return False
    cleaned = commit_message_after_stripping_agent_coauthor(proc.stdout)
    if cleaned == proc.stdout:
        return True
    tried_signed = should_try_signed_amend(cwd)
    if tried_signed and try_sign_tip_with_message(cwd, cleaned):
        return True
    if tried_signed:
        report_hook_failure(
            "signed amend failed or timed out; falling back to unsigned"
        )
    unsigned = run_git(
        [*AMEND_COMMIT_ARGS, "--no-gpg-sign"],
        cwd=cwd,
        input_text=cleaned,
        env=env_for_tip_amend(cwd),
    )
    if unsigned.returncode != 0:
        detail = (unsigned.stderr or unsigned.stdout or "").strip()
        report_hook_failure(
            "git commit --amend failed" + (f": {detail}" if detail else "")
        )
        return False
    return True


def git_commit_statement_is_strip_eligible(
    statement: list[str], *, cwd: str | None
) -> bool:
    if not tokens_are_git_commit_command(statement):
        return False
    indices = git_command_indices(statement)
    if indices is None:
        return False
    _, commit_index = indices
    if git_commit_is_dry_run(statement, commit_index):
        return False
    if git_commit_is_amend(statement, commit_index):
        return False
    if git_command_selects_another_repository(statement, commit_index):
        return False
    if cwd:
        commit_dir = working_directory_from_git_minus_c_options(
            cwd, statement, commit_index
        )
        if commit_dir is None:
            return False
        if os.path.abspath(commit_dir) != os.path.abspath(cwd):
            return False
    elif any(
        token == "-C" or directory_from_attached_git_c_option(token) is not None
        for token in statement[:commit_index]
    ):
        return False
    return True


def trailing_and_linked_quiet_eligible_count_and_last_is_quiet(
    command: str, cwd: str | None
) -> tuple[int, bool]:
    """&&-linked quiet eligible commits from the last one backward.

    The bool is whether that last eligible commit is quiet (the current tip,
    or the commit a trailing --amend replaced).
    """
    tokens = shell_tokens(command)
    if not tokens:
        return 0, False
    statements = split_shell_statements(tokens)
    if statements is None:
        return 0, False
    last_eligible: int | None = None
    for index, (statement, _following) in enumerate(statements):
        if git_commit_statement_is_strip_eligible(statement, cwd=cwd):
            last_eligible = index
    if last_eligible is None:
        return 0, False
    last_statement = statements[last_eligible][0]
    indices = git_command_indices(last_statement)
    if indices is None:
        return 0, False
    last_eligible_is_quiet = git_commit_is_quiet(last_statement, indices[1])
    count = 1 if last_eligible_is_quiet else 0
    index = last_eligible
    while index > 0:
        previous, operator = statements[index - 1]
        if operator != "&&":
            break
        if git_commit_statement_is_strip_eligible(previous, cwd=cwd):
            previous_indices = git_command_indices(previous)
            if previous_indices is None or not git_commit_is_quiet(
                previous, previous_indices[1]
            ):
                break
            count += 1
            index -= 1
            continue
        if statement_is_safe_commit_suffix(
            previous,
            allowed_git_subcommands=SAFE_SUFFIX_GIT_SUBCOMMANDS,
            forbid_verbose_status=False,
        ):
            index -= 1
            continue
        break
    return count, last_eligible_is_quiet


def loud_strip_eligible_commit_count(command: str, cwd: str | None) -> int:
    """Strip-eligible commits that print a summary (not --quiet)."""
    tokens = shell_tokens(command)
    if not tokens:
        return 0
    statements = split_shell_statements(tokens)
    if statements is None:
        return 0
    count = 0
    for statement, _following in statements:
        if not git_commit_statement_is_strip_eligible(statement, cwd=cwd):
            continue
        indices = git_command_indices(statement)
        if indices is None:
            continue
        if not git_commit_is_quiet(statement, indices[1]):
            count += 1
    return count


def commit_full_hash_is_in_reported_summaries(full_hash: str, output: str) -> bool:
    return any(
        full_hash.startswith(match.group("commit"))
        for match in COMMIT_SUMMARY_RE.finditer(output)
    )


def linear_commits_from_tip_for_shell_commits(
    cwd: str | None, command: str, output: str
) -> list[str]:
    """Newest-first hashes: HEAD, then reported ancestors or &&-quiet slots."""
    head = run_git(["rev-parse", "HEAD"], cwd=cwd)
    if head.returncode != 0:
        return []
    hashes = [head.stdout.strip()]
    quiet_total, last_eligible_is_quiet = (
        trailing_and_linked_quiet_eligible_count_and_last_is_quiet(command, cwd)
    )
    # quiet_total includes the last eligible commit when it is quiet (the
    # current tip, or the quiet tip a trailing --amend replaced). Subtract
    # that so it is not counted as an ancestor. A loud last eligible commit
    # is not in quiet_total, including when the last statement is --amend.
    quiet_ancestor_slots = (
        quiet_total - 1 if last_eligible_is_quiet else quiet_total
    )
    if quiet_ancestor_slots < 0:
        quiet_ancestor_slots = 0
    # Cap summary-based ancestors to loud Shell commits so && git log/show
    # custom formats cannot forge extra ancestors into the rewrite set.
    loud_total = loud_strip_eligible_commit_count(command, cwd)
    loud_ancestor_slots = (
        loud_total if last_eligible_is_quiet else max(0, loud_total - 1)
    )
    for index in range(1, ANCESTOR_WALK_LIMIT):
        proc = run_git(["rev-parse", f"HEAD~{index}"], cwd=cwd)
        if proc.returncode != 0:
            break
        full_hash = proc.stdout.strip()
        if loud_ancestor_slots > 0 and commit_full_hash_is_in_reported_summaries(
            full_hash, output
        ):
            hashes.append(full_hash)
            loud_ancestor_slots -= 1
            continue
        if quiet_ancestor_slots > 0:
            hashes.append(full_hash)
            quiet_ancestor_slots -= 1
            continue
        break
    return hashes


def env_for_rewritten_commit(cwd: str | None, rev: str) -> dict[str, str]:
    env = env_without_git_repository_selectors()
    for key in (*GIT_AUTHOR_ENV_KEYS, *GIT_COMMITTER_ENV_KEYS):
        env.pop(key, None)
    ident = run_git(
        ["log", "-1", "--format=%an%n%ae%n%aI%n%cI", rev], cwd=cwd
    )
    lines = ident.stdout.splitlines()
    if ident.returncode == 0 and len(lines) >= 4:
        env["GIT_AUTHOR_NAME"] = lines[0]
        env["GIT_AUTHOR_EMAIL"] = lines[1]
        env["GIT_AUTHOR_DATE"] = lines[2]
        env["GIT_COMMITTER_DATE"] = lines[3]
    if git_committer_identity_is_configured(cwd):
        return env
    committer = run_git(["log", "-1", "--format=%cn%n%ce", rev], cwd=cwd)
    names = committer.stdout.splitlines()
    if committer.returncode == 0 and len(names) >= 2:
        env["GIT_COMMITTER_NAME"] = names[0]
        env["GIT_COMMITTER_EMAIL"] = names[1]
    return env


def commit_tree_stdin_for_stored_message(message: str) -> str:
    """Drop one trailing newline: git commit-tree appends one to the stored body."""
    return message[:-1] if message.endswith("\n") else message


def try_signed_commit_tree(
    cwd: str | None,
    *,
    tree: str,
    parent: str | None,
    message: str,
    env: dict[str, str],
    wrapper: str,
) -> str | None:
    """Best-effort signed commit-tree. None if signing fails."""
    args = [
        "-c",
        "commit.gpgsign=true",
        "-c",
        f"gpg.program={wrapper}",
        "commit-tree",
        "-S",
        tree,
    ]
    if parent is not None:
        args.extend(["-p", parent])
    created = run_git(
        args,
        cwd=cwd,
        env=env,
        input_text=commit_tree_stdin_for_stored_message(message),
        timeout=AMEND_SIGNED_TIMEOUT_SECONDS,
    )
    if created.returncode != 0:
        return None
    new_hash = created.stdout.strip()
    return new_hash or None


def unsigned_commit_tree(
    cwd: str | None,
    *,
    tree: str,
    parent: str | None,
    message: str,
    env: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    args = ["-c", "commit.gpgsign=false", "commit-tree", tree]
    if parent is not None:
        args.extend(["-p", parent])
    return run_git(
        args,
        cwd=cwd,
        env=env,
        input_text=commit_tree_stdin_for_stored_message(message),
    )


def rewrite_linear_commits_stripping_agent_coauthor(
    cwd: str | None, hashes_newest_first: list[str]
) -> bool:
    oldest_first = list(reversed(hashes_newest_first))
    parent_proc = run_git(["rev-parse", f"{oldest_first[0]}^"], cwd=cwd)
    parent: str | None = (
        parent_proc.stdout.strip() if parent_proc.returncode == 0 else None
    )
    wrapper = None
    try:
        wanted_signed = any(
            should_try_signed_rewrite_of_commit(cwd, rev) for rev in oldest_first
        )
        if wanted_signed:
            try:
                wrapper = gpg_pinentry_error_wrapper_path(cwd)
            except OSError:
                wrapper = None
                report_hook_failure(
                    "gpg wrapper setup failed; falling back to unsigned"
                )
        for rev in oldest_first:
            body = run_git(["log", "-1", "--format=%B", rev], cwd=cwd)
            if body.returncode != 0:
                detail = (body.stderr or body.stdout or "").strip()
                report_hook_failure(
                    "git log failed" + (f": {detail}" if detail else "")
                )
                return False
            cleaned = commit_message_after_stripping_agent_coauthor(body.stdout)
            tree = run_git(["rev-parse", f"{rev}^{{tree}}"], cwd=cwd)
            if tree.returncode != 0:
                detail = (tree.stderr or tree.stdout or "").strip()
                report_hook_failure(
                    "git rev-parse tree failed" + (f": {detail}" if detail else "")
                )
                return False
            env = env_for_rewritten_commit(cwd, rev)
            tree_hash = tree.stdout.strip()
            created_hash = None
            tried_signed = (
                wrapper is not None and should_try_signed_rewrite_of_commit(cwd, rev)
            )
            if tried_signed:
                created_hash = try_signed_commit_tree(
                    cwd,
                    tree=tree_hash,
                    parent=parent,
                    message=cleaned,
                    env=env,
                    wrapper=wrapper,
                )
            if created_hash is None:
                if tried_signed:
                    report_hook_failure(
                        "signed commit-tree failed or timed out; "
                        "falling back to unsigned"
                    )
                    unlink_quietly(wrapper)
                    wrapper = None
                created = unsigned_commit_tree(
                    cwd,
                    tree=tree_hash,
                    parent=parent,
                    message=cleaned,
                    env=env,
                )
                if created.returncode != 0:
                    detail = (created.stderr or created.stdout or "").strip()
                    report_hook_failure(
                        "git commit-tree failed"
                        + (f": {detail}" if detail else "")
                    )
                    return False
                created_hash = created.stdout.strip()
            parent = created_hash
        expected_tip = hashes_newest_first[0]
        updated = run_git(["update-ref", "HEAD", parent, expected_tip], cwd=cwd)
        if updated.returncode != 0:
            detail = (updated.stderr or updated.stdout or "").strip()
            report_hook_failure(
                "git update-ref HEAD failed" + (f": {detail}" if detail else "")
            )
            return False
        return True
    finally:
        unlink_quietly(wrapper)


def strip_agent_coauthor_from_shell_commits(
    cwd: str | None, command: str, output: str
) -> bool:
    hashes = linear_commits_from_tip_for_shell_commits(cwd, command, output)
    if not hashes:
        return True
    needs_strip = [rev_has_agent_coauthor(cwd, rev) for rev in hashes]
    if not any(needs_strip):
        return True
    if any(commit_parent_count(cwd, rev) not in (0, 1) for rev in hashes):
        return amend_tip_stripping_agent_coauthor(cwd)
    if not any(needs_strip[1:]):
        return amend_tip_stripping_agent_coauthor(cwd)
    return rewrite_linear_commits_stripping_agent_coauthor(cwd, hashes)


def decoded_tool_output(payload: dict[str, Any]) -> Any:
    tool_output = payload.get("tool_output")
    if isinstance(tool_output, dict):
        return tool_output
    if not isinstance(tool_output, str):
        return None
    try:
        return json.loads(tool_output)
    except json.JSONDecodeError:
        return tool_output


def shell_output_from_post_tool_use(payload: dict[str, Any]) -> str:
    decoded = decoded_tool_output(payload)
    if decoded is None:
        return ""
    if isinstance(decoded, str):
        return decoded
    if not isinstance(decoded, dict):
        return ""
    return "\n".join(
        value
        for key in ("stdout", "stderr", "output")
        if isinstance(value := decoded.get(key), str)
    )


def shell_exit_code_from_post_tool_use(payload: dict[str, Any]) -> int | None:
    decoded = decoded_tool_output(payload)
    if not isinstance(decoded, dict):
        return None
    for key in ("exitCode", "exit_code"):
        value = decoded.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().lstrip("-").isdigit():
            return int(value.strip())
    return None


def tip_matches_reported_commit(cwd: str, output: str) -> bool:
    head = run_git(["rev-parse", "HEAD"], cwd=cwd)
    if head.returncode != 0:
        return False
    return commit_full_hash_is_in_reported_summaries(head.stdout.strip(), output)


def reported_commit_may_strip_tip(
    cwd: str, output: str, payload: dict[str, Any]
) -> bool:
    # A present non-zero exit means the Shell failed; do not trust a summary
    # that may have come from an earlier command in the chain.
    if not tip_matches_reported_commit(cwd, output):
        return False
    exit_code = shell_exit_code_from_post_tool_use(payload)
    return exit_code is None or exit_code == 0


def quiet_git_commit_command(command: str) -> bool:
    command_tokens = last_git_commit_command_tokens(command)
    if command_tokens is None:
        return False
    commit_tokens, _prefix_tokens, suffix_tokens = command_tokens
    if not suffix_allows_quiet_commit_strip(suffix_tokens):
        return False
    indices = git_command_indices(commit_tokens)
    if indices is None:
        return False
    _, commit_index = indices
    return git_commit_is_quiet(commit_tokens, commit_index)


def quiet_commit_may_strip_tip(command: str, payload: dict[str, Any]) -> bool:
    # Quiet commits print no summary. postToolUse means the Shell ran; skip
    # only when a present non-zero exit code shows the commit failed.
    if not quiet_git_commit_command(command):
        return False
    exit_code = shell_exit_code_from_post_tool_use(payload)
    return exit_code is None or exit_code == 0


def handle_post_tool_use(payload: dict[str, Any]) -> None:
    if payload.get("tool_name") != "Shell":
        return
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return
    command = tool_input.get("command")
    if not isinstance(command, str):
        return
    cwd = git_working_directory(payload, command, tool_input)
    if cwd is None:
        return
    output = shell_output_from_post_tool_use(payload)
    if not reported_commit_may_strip_tip(
        cwd, output, payload
    ) and not quiet_commit_may_strip_tip(command, payload):
        return
    strip_agent_coauthor_from_shell_commits(cwd, command, output)


def emit_allow() -> None:
    emit({"permission": "allow"})


def main() -> int:
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            emit_allow()
            return 0
        payload = json.loads(raw)
    except Exception:
        try:
            emit_allow()
        except Exception:
            pass
        return 0

    event = payload.get("hook_event_name") or ""
    try:
        if event == "preToolUse":
            handle_pre_tool_use(payload)
        elif event == "postToolUse":
            handle_post_tool_use(payload)
        else:
            # Unknown event: fail-open like preToolUse when tool_name is present.
            if "tool_name" in payload:
                emit_allow()
    except Exception:
        # postToolUse must stay silent on stdout; only preToolUse needs allow.
        if event == "preToolUse" or (
            event != "postToolUse" and "tool_name" in payload
        ):
            try:
                emit_allow()
            except Exception:
                pass
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

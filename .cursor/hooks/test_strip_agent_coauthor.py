#!/usr/bin/env python3
"""Tests for strip-agent-coauthor.py. Run: python3 -B .cursor/hooks/test_strip_agent_coauthor.py"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HOOK = Path(__file__).with_name("strip-agent-coauthor.py")
HOOK_CONFIG = HOOK.parent.parent / "hooks.json"


def load_hook():
    spec = importlib.util.spec_from_file_location("strip_agent_coauthor", HOOK)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {HOOK}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hook = load_hook()


def post_tool_payload(
    command: str,
    cwd: Path,
    output: str,
    *,
    exit_code: int | None = None,
) -> dict[str, object]:
    tool_result: dict[str, object] = {"stdout": output}
    if exit_code is not None:
        tool_result["exitCode"] = exit_code
    return {
        "hook_event_name": "postToolUse",
        "tool_name": "Shell",
        "tool_input": {"command": command, "working_directory": str(cwd)},
        "tool_output": json.dumps(tool_result),
        "cwd": str(cwd),
    }


def count_strip_eligible_statements(
    command: str, cwd: str | None = None
) -> int:
    tokens = hook.shell_tokens(command)
    if not tokens:
        return 0
    statements = hook.split_shell_statements(tokens)
    if statements is None:
        return 0
    return sum(
        1
        for statement, _following in statements
        if hook.git_commit_statement_is_strip_eligible(statement, cwd=cwd)
    )


class LooksLikeGitCommitTests(unittest.TestCase):
    def test_env_prefixed_commit(self) -> None:
        self.assertTrue(
            hook.looks_like_git_commit(
                "GIT_AUTHOR_NAME='weakish' GIT_AUTHOR_EMAIL='a@b.c' git commit -m x"
            )
        )
        self.assertTrue(
            hook.looks_like_git_commit(
                'GIT_AUTHOR_NAME="Jane Doe" GIT_AUTHOR_EMAIL="jane@example.com" git commit -m x'
            )
        )
        self.assertTrue(
            hook.looks_like_git_commit("env GIT_AUTHOR_NAME=x git commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit(
                "env -u GIT_DIR GIT_WORK_TREE=/tmp git commit -m x"
            )
        )
        self.assertTrue(
            hook.looks_like_git_commit("env A=1 env B=2 git commit -m x")
        )

    def test_plain_and_chained(self) -> None:
        self.assertTrue(hook.looks_like_git_commit("git commit -m x"))
        self.assertTrue(hook.looks_like_git_commit("git add a && git commit -m x"))
        self.assertTrue(hook.looks_like_git_commit("git add a\ngit commit -m x"))
        self.assertTrue(hook.looks_like_git_commit("git add a\n  git commit -m x"))
        self.assertTrue(hook.looks_like_git_commit("git commit -m x 2>&1"))
        self.assertTrue(hook.looks_like_git_commit("git commit -m x 2>&1 && git status"))

    def test_path_and_sudo(self) -> None:
        self.assertTrue(hook.looks_like_git_commit("/usr/bin/git commit -m x"))
        self.assertTrue(hook.looks_like_git_commit("sudo git commit -m x"))
        self.assertTrue(hook.looks_like_git_commit("sudo /usr/bin/git commit -m x"))
        self.assertTrue(hook.looks_like_git_commit("sudo -E git commit -m x"))
        self.assertTrue(
            hook.looks_like_git_commit("sudo --preserve-env git commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit("sudo -E /usr/bin/git commit -m x")
        )
        self.assertTrue(hook.looks_like_git_commit("sudo -n git commit -m x"))
        self.assertTrue(
            hook.looks_like_git_commit("sudo --non-interactive git commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit("sudo -u root git commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit("sudo --user=root git commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit("sudo --user root git commit -m x")
        )
        self.assertTrue(hook.looks_like_git_commit("sudo -- git commit -m x"))
        self.assertTrue(
            hook.looks_like_git_commit("sudo -nE -- git commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit("sudo env FOO=1 git commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit("sudo GIT_AUTHOR_NAME=x git commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit(
                "sudo -E env FOO=1 GIT_AUTHOR_EMAIL=a@b.c git commit -m x"
            )
        )
        self.assertTrue(
            hook.looks_like_git_commit('"/path with spaces/git" commit -m x')
        )
        self.assertTrue(
            hook.looks_like_git_commit("'/path with spaces/git' commit -m x")
        )
        self.assertTrue(
            hook.looks_like_git_commit('sudo "/path with spaces/git" commit -m x')
        )

    def test_git_options_before_commit(self) -> None:
        self.assertTrue(hook.looks_like_git_commit("git -C /tmp/repo commit -m x"))
        self.assertTrue(
            hook.looks_like_git_commit('git -C "/path with spaces" commit -m x')
        )
        self.assertTrue(hook.looks_like_git_commit("git -c user.name=x commit -m x"))
        self.assertTrue(
            hook.looks_like_git_commit(
                "git --git-dir /other/.git --work-tree /other commit -m x"
            )
        )

    def test_non_commit(self) -> None:
        self.assertFalse(hook.looks_like_git_commit("git log -1"))
        self.assertFalse(hook.looks_like_git_commit("echo commit"))
        self.assertFalse(hook.looks_like_git_commit("echo git commit"))
        self.assertFalse(hook.looks_like_git_commit("git svn commit"))
        self.assertFalse(hook.looks_like_git_commit("git commit-tree HEAD^{tree}"))
        self.assertFalse(hook.looks_like_git_commit("/usr/bingit commit -m x"))


class MainFailOpenTests(unittest.TestCase):
    def test_invalid_json_emits_allow(self) -> None:
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            patch.object(sys, "stdin", io.StringIO("{not json")),
        ):
            self.assertEqual(hook.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {"permission": "allow"})

    def test_empty_stdin_emits_allow(self) -> None:
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            patch.object(sys, "stdin", io.StringIO("")),
        ):
            self.assertEqual(hook.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {"permission": "allow"})

    def test_post_tool_use_exception_emits_no_stdout(self) -> None:
        payload = {
            "hook_event_name": "postToolUse",
            "tool_name": "Shell",
            "tool_input": {"command": "git commit -m x"},
        }
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            patch.object(sys, "stdin", io.StringIO(json.dumps(payload))),
            patch.object(
                hook,
                "handle_post_tool_use",
                side_effect=RuntimeError("boom"),
            ),
        ):
            self.assertEqual(hook.main(), 0)
        self.assertEqual(output.getvalue(), "")

    def test_pre_tool_use_exception_still_emits_allow(self) -> None:
        payload = {
            "hook_event_name": "preToolUse",
            "tool_name": "Shell",
            "tool_input": {"command": "git commit -m x"},
        }
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            patch.object(sys, "stdin", io.StringIO(json.dumps(payload))),
            patch.object(
                hook,
                "handle_pre_tool_use",
                side_effect=RuntimeError("boom"),
            ),
        ):
            self.assertEqual(hook.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {"permission": "allow"})


class PreToolUseTests(unittest.TestCase):
    def test_strips_trailer_for_alternate_repository_selector(self) -> None:
        command = (
            "git --git-dir /other/.git --work-tree /other commit -m x "
            '--trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            hook.handle_pre_tool_use(
                {"tool_name": "Shell", "tool_input": {"command": command}}
            )
        result = json.loads(output.getvalue())
        self.assertNotIn(
            "cursoragent@cursor.com",
            result["updated_input"]["command"],
        )

    def test_keeps_agent_coauthor_example_in_heredoc_body(self) -> None:
        command = (
            "git commit -m \"$(cat <<'EOF'\n"
            "subject\n\n"
            "Do not add this trailer by hand:\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n\n"
            "Assisted-by: Cursor:cursor-grok-4.5\n"
            "EOF\n"
            ')" '
            '--trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            hook.handle_pre_tool_use(
                {"tool_name": "Shell", "tool_input": {"command": command}}
            )
        result = json.loads(output.getvalue())
        cleaned = result["updated_input"]["command"]
        self.assertIn(
            "Co-authored-by: Cursor <cursoragent@cursor.com>",
            cleaned,
        )
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)
        self.assertNotIn("--trailer", cleaned)

    def test_strips_trailing_agent_coauthor_from_heredoc_body(self) -> None:
        command = (
            "git commit -m \"$(cat <<'EOF'\n"
            "subject\n\n"
            "body\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
            "EOF\n"
            ')"'
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            hook.handle_pre_tool_use(
                {"tool_name": "Shell", "tool_input": {"command": command}}
            )
        result = json.loads(output.getvalue())
        cleaned = result["updated_input"]["command"]
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        # Normalize trailing newlines like amend/rewrite (no extra blank before EOF).
        self.assertIn("subject\n\nbody\nEOF\n", cleaned)
        self.assertNotIn("subject\n\nbody\n\nEOF", cleaned)

    def test_normalizes_subject_only_heredoc_after_stripping_agent(self) -> None:
        command = (
            "git commit -m \"$(cat <<'EOF'\n"
            "subject\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
            "EOF\n"
            ')"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("subject\nEOF\n", cleaned)
        self.assertNotIn("subject\n\nEOF", cleaned)

    def test_preserves_whitespace_between_heredoc_opener_and_tag(self) -> None:
        command = (
            "git commit -m \"$(cat <<  'EOF'\n"
            "subject\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
            "EOF\n"
            ')"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("<<  'EOF'\n", cleaned)

    def test_strips_tab_indented_dash_heredoc_closer(self) -> None:
        command = (
            "git commit -m \"$(cat <<-EOF\n"
            "subject\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
            "\tEOF\n"
            ')"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("\tEOF", cleaned)

    def test_does_not_strip_unrelated_heredoc_before_commit(self) -> None:
        command = (
            "cat <<'EOF'\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
            "EOF\n"
            "git commit -m x "
            '--trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertIn(
            "cat <<'EOF'\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
            "EOF\n",
            cleaned,
        )
        self.assertNotIn("--trailer", cleaned)
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)

    def test_keeps_minus_m_agent_example_inside_commit_heredoc(self) -> None:
        command = (
            "git commit -m \"$(cat <<'EOF'\n"
            "document the hook\n\n"
            'example: git commit -m "fix\n\n'
            'Co-authored-by: Cursor <cursoragent@cursor.com>"\n\n'
            "The hook strips injected copies.\n"
            "EOF\n"
            ')"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertIn(
            'example: git commit -m "fix\n\n'
            'Co-authored-by: Cursor <cursoragent@cursor.com>"',
            cleaned,
        )
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)

    def test_keeps_minus_m_agent_example_inside_quoted_commit_message(self) -> None:
        command = (
            "git commit -m 'subject\n\n"
            'example: git commit -m "fix\n\n'
            'Co-authored-by: Cursor <cursoragent@cursor.com>"\n\n'
            "The hook strips injected copies.'"
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertIn(
            'example: git commit -m "fix\n\n'
            'Co-authored-by: Cursor <cursoragent@cursor.com>"',
            cleaned,
        )
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)

    def test_strips_quoted_minus_m_message_body(self) -> None:
        command = (
            'git commit -m "subject\n\n'
            "body\n\n"
            'Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("subject\n\nbody\n", cleaned)

    def test_drops_agent_only_minus_m_flag(self) -> None:
        only_agent = (
            'git commit -m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned_only = hook.strip_agent_from_shell_command(only_agent)
        self.assertNotIn("cursoragent@cursor.com", cleaned_only)
        self.assertNotIn('-m ""', cleaned_only)
        self.assertNotIn("-m$''", cleaned_only)
        self.assertEqual(cleaned_only, "git commit -m ''")

        with_subject = (
            'git commit -m "subject" '
            '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_from_shell_command(with_subject)
        self.assertEqual(cleaned, 'git commit -m "subject"')
        self.assertNotIn("cursoragent@cursor.com", cleaned)

        glued_after = (
            'git commit -m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            "--signoff"
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(glued_after),
            "git commit -m '' --signoff",
        )

        glued_after_subject = (
            'git commit -m "subject" '
            '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            "--signoff"
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(glued_after_subject),
            'git commit -m "subject" --signoff',
        )

        glued_value = "git commit -mCo-authored-by:cursoragent@cursor.com"
        self.assertEqual(
            hook.strip_agent_from_shell_command(glued_value),
            "git commit -m ''",
        )

        unquoted_equals = (
            "git commit --message=Co-authored-by:cursoragent@cursor.com"
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(unquoted_equals),
            "git commit -m ''",
        )

        glued_subject_then_agent = (
            "git commit -msubject -mCo-authored-by:cursoragent@cursor.com"
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(glued_subject_then_agent),
            "git commit -msubject",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                "git commit -m Co-authored-by:cursoragent@cursor.com"
            ),
            "git commit -m ''",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit -m "Co-authored-by: Cursor <cursoragent@cursor.com>" '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit -m ''",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --amend -m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit --amend --no-edit",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --amend --no-edit '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit --amend --no-edit",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit -c HEAD '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit -c HEAD --no-edit",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit -t /tmp/tmpl '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit -t /tmp/tmpl -m ''",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --reus=HEAD '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit --reus=HEAD",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --reu=HEAD '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit --reu=HEAD",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --reed=HEAD '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit --reed=HEAD --no-edit",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --ree=HEAD '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit --ree=HEAD --no-edit",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --amend --no-ed '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit --amend --no-ed",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --amend --no-e '
                '-m "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit --amend --no-e",
        )
        self.assertEqual(
            hook.strip_agent_from_shell_command(
                'git commit --mes "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            "git commit -m ''",
        )

    def test_keeps_example_in_quoted_minus_m_body(self) -> None:
        command = (
            'git commit -m "subject\n\n'
            "Do not add this trailer by hand:\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n\n"
            'Assisted-by: Cursor:cursor-grok-4.5"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertIn(
            "Do not add this trailer by hand:\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n\n"
            "Assisted-by:",
            cleaned,
        )
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)

    def test_strips_ansi_c_quoted_minus_m_message(self) -> None:
        command = (
            "git commit -m$'subject\\n\\n"
            "body\\n\\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\\n'"
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("subject", cleaned)
        self.assertIn("body", cleaned)
        self.assertIn("git commit -m$'", cleaned)

    def test_strips_double_quoted_minus_m_with_escaped_quotes(self) -> None:
        command = (
            'git commit -m "subject with \\"quotes\\"\n\n'
            "body\n\n"
            'Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn('subject with \\"quotes\\"', cleaned)
        self.assertIn("body", cleaned)

    def test_preserves_bare_dollar_expansion_when_rewriting_stripped_double_quoted_minus_m(
        self,
    ) -> None:
        command = (
            'git commit -m "subject\n\n'
            "price $5\n\n"
            'Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("price $5", cleaned)
        self.assertNotIn(r"price \$5", cleaned)

    def test_preserves_escaped_dollar_in_stripped_double_quoted_minus_m(self) -> None:
        command = (
            'git commit -m "cost \\$5\n\n'
            'Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn(r"cost \$5", cleaned)

    def test_preserves_escaped_backtick_in_stripped_double_quoted_minus_m(self) -> None:
        command = (
            'git commit -m "run \\`date\\`\n\n'
            'Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn(r"run \`date\`", cleaned)

    def test_strips_ansi_c_unicode_and_control_escapes(self) -> None:
        command = (
            "git commit -m$'subject\\n\\n"
            "A\\u0041\\n\\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\\n'"
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("AA", cleaned)
        self.assertEqual(
            hook.decode_ansi_c_quoted_body(r"\u0041\U00000042\cI"),
            "AB\t",
        )
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\u41"), "A")
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\U42"), "B")
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\u"), r"\u")
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\U"), r"\U")
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\x"), r"\x")
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\777"), "\xff")
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\400"), "\x00")
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\101"), "A")

        empty_hex = (
            "git commit -m$'subject\\n\\n"
            "keep \\x\\n\\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\\n'"
        )
        cleaned_hex = hook.strip_agent_from_shell_command(empty_hex)
        self.assertNotIn("cursoragent@cursor.com", cleaned_hex)
        self.assertIn(r"keep \\x", cleaned_hex)

        empty_unicode = (
            "git commit -m$'subject\\n\\n"
            "keep \\u\\n\\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\\n'"
        )
        cleaned_empty = hook.strip_agent_from_shell_command(empty_unicode)
        self.assertNotIn("cursoragent@cursor.com", cleaned_empty)
        self.assertIn(r"keep \\u", cleaned_empty)

        short_unicode = (
            "git commit -m$'subject\\n\\n"
            "A\\u41\\n\\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\\n'"
        )
        cleaned_short = hook.strip_agent_from_shell_command(short_unicode)
        self.assertNotIn("cursoragent@cursor.com", cleaned_short)
        self.assertIn("AA", cleaned_short)

        self.assertEqual(
            hook.decode_ansi_c_quoted_body(r"\U110000"),
            b"\xf4\x90\x80\x80".decode("latin-1"),
        )
        self.assertEqual(hook.decode_ansi_c_quoted_body(r"\UFFFFFFFF"), "")
        out_of_range = (
            "git commit -m$'subject\\n\\n"
            "keep \\U110000\\n\\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\\n'"
        )
        cleaned_range = hook.strip_agent_from_shell_command(out_of_range)
        self.assertNotIn("cursoragent@cursor.com", cleaned_range)
        self.assertIn("keep", cleaned_range)


class HookConfigTests(unittest.TestCase):
    def test_post_tool_hook_filters_on_shell(self) -> None:
        config = json.loads(HOOK_CONFIG.read_text(encoding="utf-8"))
        self.assertNotIn("afterShellExecution", config["hooks"])
        self.assertEqual(
            config["hooks"]["postToolUse"][0]["matcher"],
            "Shell",
        )
        command = config["hooks"]["postToolUse"][0]["command"]
        self.assertEqual(
            command,
            "python3 -B .cursor/hooks/strip-agent-coauthor.py",
        )
        self.assertEqual(
            config["hooks"]["preToolUse"][0]["command"],
            command,
        )
        self.assertEqual(config["hooks"]["preToolUse"][0]["timeout"], 180)
        self.assertEqual(config["hooks"]["postToolUse"][0]["timeout"], 180)

    def test_git_commits_skill_documents_hook_test_command(self) -> None:
        skill = (
            Path(__file__).resolve().parents[2]
            / ".agents"
            / "skills"
            / "git-commits"
            / "SKILL.md"
        )
        text = skill.read_text(encoding="utf-8")
        self.assertIn(
            "python3 -B .cursor/hooks/test_strip_agent_coauthor.py",
            text,
        )


class GitWorkingDirectoryTests(unittest.TestCase):
    def test_git_minus_c_uses_the_commit_command(self) -> None:
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git -C /other commit -m x",
            ),
            "/other",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git -C/other commit -m x",
            ),
            "/other",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                'git -C "/other with spaces" commit -m x',
            ),
            "/other with spaces",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace/project"},
                "git -C ../other commit -m x",
            ),
            "/workspace/other",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git -c user.name=human commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "sudo -E git -C /other commit -m x",
            ),
            "/other",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                '"/path with spaces/git" -C /other commit -m x',
            ),
            "/other",
        )

    def test_cd_then_git_and_git_minus_c_resolve_from_payload_cwd(self) -> None:
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "cd child && git commit -m x",
            ),
            "/workspace/child",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "cd child && git -C deeper commit -m x",
            ),
            "/workspace/child/deeper",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "cd /other; git commit -m x",
            ),
            "/other",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "cd /tmp/repo\ngit commit -m x",
            ),
            "/tmp/repo",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                'cd "/tmp/repo with spaces"\ngit commit -m x',
            ),
            "/tmp/repo with spaces",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "pushd /other && git commit -m x",
            ),
            "/other",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "FOO=1 cd /other && git commit -m x",
            ),
            "/other",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "sudo cd /other && git commit -m x",
            ),
            "/other",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "sudo -u root pushd /other && git commit -m x",
            ),
            "/other",
        )

    def test_prior_shell_commands_keep_payload_cwd(self) -> None:
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git add tracked.txt && git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "sudo git add tracked.txt && git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "sudo env FOO=1 git add tracked.txt && git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git add tracked.txt\ngit commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git rm -f tracked.txt && git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "env FOO=1 git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "env FOO=1 git add a && git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "env A=1 env B=2 git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status && git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git -C /other status && git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status --no-verbose && git commit -m x",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status --verbose --no-verbose && git commit -m x",
            ),
            "/workspace",
        )

    def test_safe_commands_after_commit_keep_payload_cwd(self) -> None:
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x && git status",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x; git status",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x\ngit status",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x && git log -1 ; git status",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x && true",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x && :",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git add tracked.txt && git commit -m x && git status",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -q -m x && git log -1",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x 2>&1",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x 2>&1 && git status",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x &>file",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x &> /tmp/out",
            ),
            "/workspace",
        )

    def test_ambiguous_shell_commands_are_skipped(self) -> None:
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "export GIT_DIR=/other/.git && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "cd /other || git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "false && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git log -1 --format=[master %h] && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git show -s --format=[master %h] && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git branch --format=[master %(objectname:short)] && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git diff && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status -v && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status --verbose && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status --v && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status --verb && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status --ve && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git status --no-verbose --verbose && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "cd - && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "pushd - && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "pushd +1 && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "pushd -2 && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "popd && git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x || true",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x && false",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x && git push",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x; git log -1",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x; git status -v",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x; git status --verbose",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x; git status && git log -1",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit --quiet -m x; true",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit --dry-run",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit --short",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit --porcelain",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -zq",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit --dry",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "GIT_DIR=/other git commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git --git-dir=/other commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git --git-dir /other commit -m x",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit-tree HEAD^{tree}",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x &",
            )
        )
        self.assertIsNone(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x |& git status",
            )
        )
        self.assertTrue(hook.looks_like_git_commit("git commit -m x |& cat"))

    def test_tool_input_working_directory_fallback(self) -> None:
        self.assertEqual(
            hook.git_working_directory(
                {},
                "git commit -m x",
                {"working_directory": "/from-tool"},
            ),
            "/from-tool",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m x",
                {"working_directory": "/from-tool"},
            ),
            "/from-tool",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "cd child && git commit -m x",
                {"working_directory": "/from-tool"},
            ),
            "/from-tool/child",
        )

    def test_prior_git_commit_keeps_payload_cwd(self) -> None:
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m a && git commit -m b",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git add tracked.txt && git commit -m a && git commit -m b",
            ),
            "/workspace",
        )
        self.assertEqual(
            hook.git_working_directory(
                {"cwd": "/workspace"},
                "git commit -m a && git status && git commit -m b",
            ),
            "/workspace",
        )

    def test_suffix_without_leading_operator_forbids_verbose_status(self) -> None:
        self.assertFalse(
            hook.suffix_allows_post_commit_strip(["git", "status", "-v"])
        )
        self.assertTrue(hook.suffix_allows_post_commit_strip(["git", "status"]))


class StripTests(unittest.TestCase):
    def test_strips_agent_line_keeps_human(self) -> None:
        text = (
            "subject\n\n"
            "Co-authored-by: human <human@example.com>\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
        )
        cleaned = hook.strip_agent_from_commit_message(text)
        self.assertIn("human@example.com", cleaned)
        self.assertNotIn("cursoragent@cursor.com", cleaned)

    def test_keeps_emails_that_only_contain_agent_address_as_substring(self) -> None:
        for lookalike in (
            "notcursoragent@cursor.com",
            "alice+cursoragent@cursor.com",
            "pre-cursoragent@cursor.com",
        ):
            message = f"subject\n\nCo-authored-by: human <{lookalike}>\n"
            self.assertEqual(hook.strip_agent_from_commit_message(message), message)
            bare = f"subject\n\nCo-authored-by: {lookalike}\n"
            self.assertEqual(hook.strip_agent_from_commit_message(bare), bare)
            quoted = (
                f'git commit -m "x" '
                f'--trailer "Co-authored-by: human <{lookalike}>"'
            )
            self.assertEqual(
                hook.strip_agent_trailer_flags_from_command(quoted),
                quoted,
            )
            equals = (
                f'git commit -m "x" '
                f'--trailer="Co-authored-by: human <{lookalike}>"'
            )
            self.assertEqual(
                hook.strip_agent_trailer_flags_from_command(equals),
                equals,
            )

    def test_keeps_agent_line_immediately_after_subject_without_blank(self) -> None:
        # git interpret-trailers requires a blank line before the trailer block.
        text = "subject\nCo-authored-by: Cursor <cursoragent@cursor.com>\n"
        self.assertEqual(hook.strip_agent_from_commit_message(text), text)

    def test_strips_agent_trailer_after_folded_continuation(self) -> None:
        text = (
            "subject\n\n"
            "Fixes: 1\n"
            "  continued\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
        )
        cleaned = hook.strip_agent_from_commit_message(text)
        self.assertIn("Fixes: 1\n  continued\n", cleaned)
        self.assertNotIn("cursoragent@cursor.com", cleaned)

    def test_strips_agent_trailer_after_body_dash_divider(self) -> None:
        text = (
            "subject\n\n"
            "body\n"
            "---\n"
            "more\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
        )
        cleaned = hook.strip_agent_from_commit_message(text)
        self.assertIn("---\nmore\n", cleaned)
        self.assertNotIn("cursoragent@cursor.com", cleaned)

    def test_keeps_message_when_interpret_trailers_fails(self) -> None:
        text = (
            "subject\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
        )
        failed = subprocess.CompletedProcess(
            ["git", "interpret-trailers"], 1, "", "forced failure\n"
        )
        with patch.object(hook, "run_git", return_value=failed):
            self.assertEqual(hook.strip_agent_from_commit_message(text), text)

    def test_strips_agent_trailer_with_trailing_hash_comment(self) -> None:
        text = (
            "subject\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
            "# note\n"
        )
        cleaned = hook.strip_agent_from_commit_message(text)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("# note\n", cleaned)

    def test_strips_agent_trailer_above_hash_comment_before_other_trailer(
        self,
    ) -> None:
        text = (
            "subject\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
            "# note\n"
            "Signed-off-by: A <a@example.com>\n"
        )
        cleaned = hook.strip_agent_from_commit_message(text)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("# note\n", cleaned)
        self.assertIn("Signed-off-by: A <a@example.com>\n", cleaned)

    def test_strips_agent_trailer_with_leading_hash_comment_in_block(self) -> None:
        text = (
            "subject\n\n"
            "# note\n"
            "Signed-off-by: A <a@example.com>\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
        )
        cleaned = hook.strip_agent_from_commit_message(text)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertIn("# note\n", cleaned)
        self.assertIn("Signed-off-by: A <a@example.com>\n", cleaned)

    def test_keeps_agent_line_when_body_precedes_trailer_without_blank(self) -> None:
        text = (
            "subject\n"
            "body paragraph\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
        )
        self.assertEqual(hook.strip_agent_from_commit_message(text), text)

    def test_keeps_unrelated_blank_lines(self) -> None:
        text = (
            "subject\n\n"
            "first paragraph\n\n\n"
            "second paragraph\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
        )
        cleaned = hook.strip_agent_from_commit_message(text)
        self.assertIn("first paragraph\n\n\nsecond paragraph", cleaned)

    def test_keeps_agent_coauthor_example_in_message_body(self) -> None:
        text = (
            "subject\n\n"
            "Do not add this trailer by hand:\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n\n"
            "The hook strips injected copies from the trailer block.\n\n"
            "Assisted-by: Cursor:cursor-grok-4.5\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
        )
        cleaned = hook.commit_message_after_stripping_agent_coauthor(text)
        self.assertIn(
            "Do not add this trailer by hand:\n\n"
            "Co-authored-by: Cursor <cursoragent@cursor.com>\n\n"
            "The hook strips injected copies",
            cleaned,
        )
        self.assertIn("Assisted-by: Cursor:cursor-grok-4.5\n", cleaned)
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)

    def test_strips_agent_trailer_without_space_after_colon(self) -> None:
        text = (
            "subject\n\n"
            "Co-authored-by:Cursor <cursoragent@cursor.com>\n"
        )
        cleaned = hook.strip_agent_from_commit_message(text)
        self.assertNotIn("cursoragent@cursor.com", cleaned)

    def test_trailer_flag_regex_uses_unique_group_names(self) -> None:
        self.assertEqual(
            set(hook.AGENT_TRAILER_FLAG_RE.groupindex),
            {"eq_q", "eq_v", "eq_u", "sp_q", "sp_v", "sp_u"},
        )

    def test_strips_agent_trailer_flag(self) -> None:
        command = (
            'git commit -m "x" '
            '--trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_trailer_flags_from_command(command)
        self.assertEqual(cleaned, 'git commit -m "x"')
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        self.assertNotIn("--trailer", cleaned)
        self.assertEqual(
            hook.strip_agent_trailer_flags_from_command(
                'git commit -m "x" '
                '--tr "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            'git commit -m "x"',
        )
        self.assertEqual(
            hook.strip_agent_trailer_flags_from_command(
                'git commit -m "x" '
                '--trail "Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            'git commit -m "x"',
        )

    def test_unquoted_trailer_equals_does_not_swallow_following_flags(self) -> None:
        command = (
            'git commit -m "x" '
            "--trailer=Co-authored-by:Cursor<cursoragent@cursor.com> --signoff"
        )
        cleaned = hook.strip_agent_trailer_flags_from_command(command)
        self.assertEqual(cleaned, 'git commit -m "x" --signoff')
        quoted = (
            'git commit -m "x" '
            '--trailer="Co-authored-by: Cursor <cursoragent@cursor.com>" --signoff'
        )
        self.assertEqual(
            hook.strip_agent_trailer_flags_from_command(quoted),
            'git commit -m "x" --signoff',
        )
        spaced = (
            'git commit -m "x" '
            "--trailer Co-authored-by: Cursor <cursoragent@cursor.com> --signoff"
        )
        self.assertEqual(
            hook.strip_agent_trailer_flags_from_command(spaced),
            'git commit -m "x" --signoff',
        )
        spaced_equals = (
            'git commit -m "x" '
            "--trailer=Co-authored-by: Cursor <cursoragent@cursor.com> --signoff"
        )
        self.assertEqual(
            hook.strip_agent_trailer_flags_from_command(spaced_equals),
            'git commit -m "x" --signoff',
        )
        glued = (
            'git commit -m "x" '
            "--trailer=Co-authored-by:Cursor<cursoragent@cursor.com>--signoff"
        )
        self.assertEqual(
            hook.strip_agent_trailer_flags_from_command(glued),
            'git commit -m "x" --signoff',
        )
        glued_bare_email = (
            'git commit -m "x" '
            "--trailer=Co-authored-by:cursoragent@cursor.com--signoff"
        )
        self.assertEqual(
            hook.strip_agent_trailer_flags_from_command(glued_bare_email),
            'git commit -m "x" --signoff',
        )

    def test_unquoted_trailer_does_not_strip_preceding_human_trailer(self) -> None:
        spaced = (
            'git commit -m "x" '
            "--trailer Co-authored-by: human <human@example.com> "
            "--trailer Co-authored-by: Cursor <cursoragent@cursor.com>"
        )
        cleaned = hook.strip_agent_trailer_flags_from_command(spaced)
        self.assertIn("human@example.com", cleaned)
        self.assertNotIn("cursoragent@cursor.com", cleaned)
        spaced_equals = (
            'git commit -m "x" '
            "--trailer=Co-authored-by: human <human@example.com> "
            "--trailer=Co-authored-by: Cursor <cursoragent@cursor.com>"
        )
        cleaned_equals = hook.strip_agent_trailer_flags_from_command(spaced_equals)
        self.assertIn("human@example.com", cleaned_equals)
        self.assertNotIn("cursoragent@cursor.com", cleaned_equals)
        self.assertEqual(
            hook.strip_agent_trailer_flags_from_command(
                'git commit -m "x" '
                '--trailer="Co-authored-by: human <human@example.com>" '
                '--trailer="Co-authored-by: Cursor <cursoragent@cursor.com>"'
            ),
            'git commit -m "x" '
            '--trailer="Co-authored-by: human <human@example.com>"',
        )

    def test_keeps_agent_trailer_flag_inside_quoted_minus_m(self) -> None:
        # Unescaped "…" after --trailer so AGENT_TRAILER_FLAG_RE matches inside
        # the single-quoted -m value (escaped \" inside double quotes does not).
        command = (
            "git commit -m 'subject\n\n"
            'do not use --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"\n\n'
            "Assisted-by: Cursor:cursor-grok-4.5'"
        )
        match = hook.AGENT_TRAILER_FLAG_RE.search(command)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertTrue(hook.shell_position_is_inside_quotes(command, match.start()))
        self.assertEqual(hook.strip_agent_trailer_flags_from_command(command), command)
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertIn("--trailer", cleaned)
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)

    def test_keeps_agent_trailer_flag_inside_ansi_c_minus_m_with_apostrophe(
        self,
    ) -> None:
        command = (
            "git commit -m$'don\\'t\\n\\n"
            '--trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"\\n\\n'
            "Assisted-by: Cursor:cursor-grok-4.5\\n'"
        )
        match = hook.AGENT_TRAILER_FLAG_RE.search(command)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertTrue(hook.shell_position_is_inside_quotes(command, match.start()))
        self.assertEqual(hook.strip_agent_trailer_flags_from_command(command), command)
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertIn("--trailer", cleaned)
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)

    def test_ansi_c_escaped_quote_keeps_newlines_quoted(self) -> None:
        prefix = "git commit -m$'don\\'t\n"
        self.assertTrue(hook.shell_position_is_inside_quotes(prefix, len(prefix)))
        self.assertTrue(hook.close_open_quotes(prefix).endswith("'"))
        rewritten = hook.unquoted_newlines_as_semicolons(prefix)
        self.assertIn("\n", rewritten)
        self.assertNotIn(" ; ", rewritten)

    def test_keeps_agent_trailer_flag_inside_heredoc_body(self) -> None:
        command = (
            "git commit -m \"$(cat <<'EOF'\n"
            "subject\n\n"
            'do not use --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"\n\n'
            "Assisted-by: Cursor:cursor-grok-4.5\n"
            "EOF\n"
            ')"'
        )
        match = hook.AGENT_TRAILER_FLAG_RE.search(command)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertTrue(
            hook.shell_position_is_inside_heredoc_body(command, match.start())
        )
        self.assertEqual(hook.strip_agent_trailer_flags_from_command(command), command)
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertIn("--trailer", cleaned)
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)

    def test_keeps_agent_trailer_flag_on_non_commit_statement(self) -> None:
        command = (
            'echo --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" && '
            'git commit -m "x" '
            '--trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"'
        )
        cleaned = hook.strip_agent_from_shell_command(command)
        self.assertIn(
            'echo --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"',
            cleaned,
        )
        self.assertEqual(cleaned.count("cursoragent@cursor.com"), 1)
        self.assertNotIn('git commit -m "x" --trailer', cleaned)


class DecodedToolOutputTests(unittest.TestCase):
    def test_accepts_dict_tool_output(self) -> None:
        payload = {
            "tool_output": {
                "stdout": "out",
                "stderr": "err",
                "exitCode": 0,
            }
        }
        self.assertEqual(hook.shell_output_from_post_tool_use(payload), "out\nerr")
        self.assertEqual(hook.shell_exit_code_from_post_tool_use(payload), 0)


AGENT_COAUTHOR_TRAILER = (
    "Co-authored-by: Cursor <cursoragent@cursor.com>\n"
)


def git_isolated_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in hook.GIT_REPOSITORY_SELECTOR_NAMES:
        env.pop(key, None)
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_AUTHOR_NAME"] = "human"
    env["GIT_AUTHOR_EMAIL"] = "human@example.com"
    env["GIT_COMMITTER_NAME"] = "human"
    env["GIT_COMMITTER_EMAIL"] = "human@example.com"
    return env


def run_git_in(path: Path, args: list[str], env: dict[str, str] | None = None) -> None:
    subprocess.run(
        ["git", *args],
        cwd=path,
        check=True,
        capture_output=True,
        env=env or git_isolated_env(),
    )


def git_output(path: Path, args: list[str]) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=path, text=True, env=git_isolated_env()
    )


def init_repo(path: Path) -> None:
    env = git_isolated_env()
    run_git_in(path, ["init"], env)
    run_git_in(path, ["config", "user.name", "human"], env)
    run_git_in(path, ["config", "user.email", "human@example.com"], env)
    (path / "tracked.txt").write_text("one\n", encoding="utf-8")
    run_git_in(path, ["add", "tracked.txt"], env)
    run_git_in(path, ["commit", "--no-gpg-sign", "-m", "first"], env)


@contextlib.contextmanager
def initialized_temporary_repo():
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp)
        init_repo(repo)
        yield repo


def replace_tip_message_with_agent_coauthor(path: Path, subject: str = "first") -> None:
    run_git_in(
        path,
        [
            "commit",
            "--amend",
            "--no-gpg-sign",
            "-m",
            f"{subject}\n\n{AGENT_COAUTHOR_TRAILER}",
        ],
    )


def commit_tracked_change_with_agent_coauthor(
    path: Path, *, subject: str = "second", quiet: bool = False
) -> None:
    (path / "tracked.txt").write_text("two\n", encoding="utf-8")
    run_git_in(path, ["add", "tracked.txt"])
    args = ["commit", "--no-gpg-sign"]
    if quiet:
        args.append("--quiet")
    args.extend(["-m", f"{subject}\n\n{AGENT_COAUTHOR_TRAILER}"])
    run_git_in(path, args)


def write_executable_script(body: str) -> Path:
    fd, raw_path = tempfile.mkstemp(prefix="strip-agent-test-", suffix=".sh")
    path = Path(raw_path)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(body)
    path.chmod(0o755)
    return path


def write_fake_gpgsig_on_tip(path: Path) -> None:
    raw = git_output(path, ["cat-file", "-p", "HEAD"])
    header, separator, body = raw.partition("\n\n")
    if not separator:
        raise RuntimeError("commit object has no header/body split")
    signed = (
        header
        + "\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n"
        + separator
        + body
    )
    sha = subprocess.check_output(
        ["git", "hash-object", "-t", "commit", "-w", "--stdin"],
        cwd=path,
        input=signed,
        text=True,
        env=git_isolated_env(),
    ).strip()
    run_git_in(path, ["reset", "--soft", sha])


def reported_commit_summary(path: Path, subject: str) -> str:
    short_head = git_output(path, ["rev-parse", "--short=7", "HEAD"]).strip()
    return f"[master {short_head}] {subject}\n"


class AmendTipTests(unittest.TestCase):
    def test_amend_does_not_pick_up_staged_files_or_env_author(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            (repo / "staged.txt").write_text("staged\n", encoding="utf-8")
            run_git_in(repo, ["add", "staged.txt"])
            with patch.dict(
                os.environ,
                {
                    "GIT_AUTHOR_NAME": "Cursor Agent",
                    "GIT_AUTHOR_EMAIL": "cursoragent@cursor.com",
                    "GIT_COMMITTER_NAME": "Cursor Agent",
                    "GIT_COMMITTER_EMAIL": "cursoragent@cursor.com",
                    "GIT_COMMITTER_DATE": "Thu, 01 Jan 1970 00:00:00 +0000",
                },
            ):
                self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
                amend_env = hook.env_for_tip_amend(str(repo))
                self.assertNotIn("GIT_COMMITTER_NAME", amend_env)
                self.assertNotIn("GIT_COMMITTER_EMAIL", amend_env)
                self.assertNotIn("GIT_COMMITTER_DATE", amend_env)
                self.assertNotIn("GIT_AUTHOR_NAME", amend_env)
                self.assertNotIn("GIT_AUTHOR_EMAIL", amend_env)
                self.assertNotIn("GIT_AUTHOR_DATE", amend_env)

            body = git_output(repo, ["log", "-1", "--format=%B"])
            self.assertNotIn("cursoragent@cursor.com", body)
            files = git_output(repo, ["ls-tree", "--name-only", "HEAD"])
            self.assertNotIn("staged.txt", files)
            author = git_output(repo, ["log", "-1", "--format=%an <%ae>"]).strip()
            self.assertEqual(author, "human <human@example.com>")
            committer = git_output(repo, ["log", "-1", "--format=%cn <%ce>"]).strip()
            self.assertEqual(committer, "human <human@example.com>")

    def test_amend_ignores_git_dir_in_process_environment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            repo = workspace / "repo"
            other = workspace / "other"
            repo.mkdir()
            other.mkdir()
            init_repo(repo)
            init_repo(other)
            replace_tip_message_with_agent_coauthor(repo)
            replace_tip_message_with_agent_coauthor(other, subject="other")
            other_head = git_output(other, ["rev-parse", "HEAD"])
            with patch.dict(os.environ, {"GIT_DIR": str(other / ".git")}):
                amend_env = hook.env_for_tip_amend(str(repo))
                self.assertNotIn("GIT_DIR", amend_env)
                self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertEqual(git_output(other, ["rev-parse", "HEAD"]), other_head)
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(other, ["log", "-1", "--format=%B"]),
            )

    def test_amend_without_user_config_reuses_tip_committer(self) -> None:
        with initialized_temporary_repo() as repo:
            run_git_in(repo, ["config", "--unset", "user.name"])
            run_git_in(repo, ["config", "--unset", "user.email"])
            env = git_isolated_env()
            env["GIT_AUTHOR_NAME"] = "Author Only"
            env["GIT_AUTHOR_EMAIL"] = "author@example.com"
            env["GIT_COMMITTER_NAME"] = "Committer Only"
            env["GIT_COMMITTER_EMAIL"] = "committer@example.com"
            run_git_in(
                repo,
                [
                    "commit",
                    "--amend",
                    "--no-gpg-sign",
                    "--reset-author",
                    "-m",
                    f"first\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
                env,
            )
            self.assertEqual(
                git_output(repo, ["log", "-1", "--format=%an <%ae>"]).strip(),
                "Author Only <author@example.com>",
            )
            self.assertEqual(
                git_output(repo, ["log", "-1", "--format=%cn <%ce>"]).strip(),
                "Committer Only <committer@example.com>",
            )
            with patch.dict(
                os.environ,
                {
                    "GIT_CONFIG_GLOBAL": os.devnull,
                    "GIT_CONFIG_SYSTEM": os.devnull,
                    "GIT_CONFIG_NOSYSTEM": "1",
                },
                clear=False,
            ):
                for key in (
                    "GIT_AUTHOR_NAME",
                    "GIT_AUTHOR_EMAIL",
                    "GIT_AUTHOR_DATE",
                    "GIT_COMMITTER_NAME",
                    "GIT_COMMITTER_EMAIL",
                    "GIT_COMMITTER_DATE",
                ):
                    os.environ.pop(key, None)
                amend_env = hook.env_for_tip_amend(str(repo))
                self.assertEqual(amend_env.get("GIT_COMMITTER_NAME"), "Committer Only")
                self.assertEqual(
                    amend_env.get("GIT_COMMITTER_EMAIL"), "committer@example.com"
                )
                self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertEqual(
                git_output(repo, ["log", "-1", "--format=%an <%ae>"]).strip(),
                "Author Only <author@example.com>",
            )
            self.assertEqual(
                git_output(repo, ["log", "-1", "--format=%cn <%ce>"]).strip(),
                "Committer Only <committer@example.com>",
            )

    def test_amend_skips_when_only_trailing_newlines_differ(self) -> None:
        with initialized_temporary_repo() as repo:
            run_git_in(
                repo,
                ["commit", "--amend", "--no-gpg-sign", "-m", "first\n\n\n"],
            )
            original_head = git_output(repo, ["rev-parse", "HEAD"])
            self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
            self.assertEqual(git_output(repo, ["rev-parse", "HEAD"]), original_head)

    def test_amend_skips_gpg_wrapper_when_signing_disabled(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            run_git_in(repo, ["config", "commit.gpgsign", "false"])
            with patch.object(hook, "gpg_pinentry_error_wrapper_path") as wrapper:
                self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
                wrapper.assert_not_called()
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_amend_tries_sign_when_tip_is_signed_without_gpgsign_config(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            run_git_in(repo, ["config", "commit.gpgsign", "false"])
            write_fake_gpgsig_on_tip(repo)
            self.assertTrue(hook.tip_commit_is_signed(str(repo)))
            real_run_git = hook.run_git
            forced_gpgsign = False

            def run_git_proxy(
                args: list[str],
                *,
                cwd: str | None = None,
                env: dict[str, str] | None = None,
                input_text: str | None = None,
                timeout: float | None = None,
            ) -> subprocess.CompletedProcess[str]:
                nonlocal forced_gpgsign
                if (
                    "commit" in args
                    and "commit.gpgsign=true" in args
                    and any(
                        token == "-c"
                        and index + 1 < len(args)
                        and args[index + 1].startswith("gpg.program=")
                        for index, token in enumerate(args)
                    )
                ):
                    forced_gpgsign = True
                return real_run_git(
                    args, cwd=cwd, env=env, input_text=input_text, timeout=timeout
                )

            with (
                patch.object(
                    hook,
                    "gpg_pinentry_error_wrapper_path",
                    wraps=hook.gpg_pinentry_error_wrapper_path,
                ) as wrapper,
                patch.object(hook, "run_git", side_effect=run_git_proxy),
            ):
                self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
                wrapper.assert_called()
            self.assertTrue(forced_gpgsign)
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_amend_falls_back_to_no_gpg_sign_when_signing_fails(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            marker = Path(tempfile.mkstemp(prefix="gpg-ran-")[1])
            marker.unlink()
            gpg = write_executable_script(
                f"#!/bin/sh\ntouch '{marker}'\nexit 1\n"
            )
            try:
                run_git_in(repo, ["config", "commit.gpgsign", "true"])
                run_git_in(repo, ["config", "gpg.format", "openpgp"])
                run_git_in(repo, ["config", "user.signingkey", "test"])
                run_git_in(repo, ["config", "gpg.program", str(gpg)])
                stderr = io.StringIO()
                with contextlib.redirect_stderr(stderr):
                    self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
                self.assertIn(
                    "falling back to unsigned",
                    stderr.getvalue(),
                )
                self.assertTrue(marker.exists())
                self.assertNotIn(
                    "cursoragent@cursor.com",
                    git_output(repo, ["log", "-1", "--format=%B"]),
                )
            finally:
                gpg.unlink(missing_ok=True)
                marker.unlink(missing_ok=True)

    def test_amend_falls_back_to_no_gpg_sign_when_signing_hangs(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            gpg = write_executable_script("#!/bin/sh\nexec tail -f /dev/null\n")
            try:
                run_git_in(repo, ["config", "commit.gpgsign", "true"])
                run_git_in(repo, ["config", "gpg.format", "openpgp"])
                run_git_in(repo, ["config", "user.signingkey", "test"])
                run_git_in(repo, ["config", "gpg.program", str(gpg)])
                stderr = io.StringIO()
                with (
                    contextlib.redirect_stderr(stderr),
                    patch.object(hook, "AMEND_SIGNED_TIMEOUT_SECONDS", 0.3),
                ):
                    self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
                self.assertIn(
                    "falling back to unsigned",
                    stderr.getvalue(),
                )
                self.assertNotIn(
                    "cursoragent@cursor.com",
                    git_output(repo, ["log", "-1", "--format=%B"]),
                )
            finally:
                gpg.unlink(missing_ok=True)

    def test_amend_skips_unsigned_fallback_when_signed_succeeds(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            run_git_in(repo, ["config", "commit.gpgsign", "true"])
            real_run_git = hook.run_git
            signed_attempts = 0
            saw_fallback_no_gpg_sign = False
            applying_signed_success = False

            def run_git_proxy(
                args: list[str],
                *,
                cwd: str | None = None,
                env: dict[str, str] | None = None,
                input_text: str | None = None,
                timeout: float | None = None,
            ) -> subprocess.CompletedProcess[str]:
                nonlocal signed_attempts, saw_fallback_no_gpg_sign
                nonlocal applying_signed_success
                is_gpg_program_amend = any(
                    token == "-c"
                    and index + 1 < len(args)
                    and args[index + 1].startswith("gpg.program=")
                    for index, token in enumerate(args)
                ) and "commit" in args
                if is_gpg_program_amend:
                    signed_attempts += 1
                    applying_signed_success = True
                    try:
                        return real_run_git(
                            [*hook.AMEND_COMMIT_ARGS, "--no-gpg-sign"],
                            cwd=cwd,
                            env=env,
                            input_text=input_text,
                        )
                    finally:
                        applying_signed_success = False
                if "--no-gpg-sign" in args and not applying_signed_success:
                    saw_fallback_no_gpg_sign = True
                return real_run_git(
                    args, cwd=cwd, env=env, input_text=input_text, timeout=timeout
                )

            with patch.object(hook, "run_git", side_effect=run_git_proxy):
                self.assertTrue(hook.amend_tip_stripping_agent_coauthor(str(repo)))
            self.assertEqual(signed_attempts, 1)
            self.assertFalse(saw_fallback_no_gpg_sign)
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_amend_reports_failure_when_not_a_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                self.assertFalse(hook.amend_tip_stripping_agent_coauthor(tmp))
            self.assertIn("strip-agent-coauthor:", stderr.getvalue())
            self.assertIn("git log -1 failed", stderr.getvalue())


class RewriteLinearCommitsTests(unittest.TestCase):
    def test_rewrite_preserves_tip_body_when_strip_is_noop(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, subject="second")
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            # Git keeps one trailing blank line (message ends with \n\n), which
            # .rstrip() + "\n" would collapse — rewrite must preserve it when
            # strip is a no-op.
            run_git_in(
                repo,
                ["commit", "--no-gpg-sign", "-m", "third\n\n"],
            )
            original_tip_message = git_output(repo, ["log", "-1", "--format=%B"])
            self.assertEqual(original_tip_message, "third\n\n")
            self.assertTrue(
                hook.rewrite_linear_commits_stripping_agent_coauthor(
                    str(repo),
                    [
                        git_output(repo, ["rev-parse", "HEAD"]).strip(),
                        git_output(repo, ["rev-parse", "HEAD~1"]).strip(),
                    ],
                )
            )
            self.assertEqual(
                git_output(repo, ["log", "-1", "--format=%B"]),
                original_tip_message,
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )

    def test_rewrite_preserves_original_committer_date(self) -> None:
        with initialized_temporary_repo() as repo:
            stamp = "2001-02-03T04:05:06+00:00"
            env = git_isolated_env()
            env["GIT_AUTHOR_DATE"] = stamp
            env["GIT_COMMITTER_DATE"] = stamp
            (repo / "tracked.txt").write_text("two\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"], env)
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"second\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
                env,
            )
            original_dates = git_output(
                repo, ["log", "-2", "--format=%cI"]
            ).splitlines()
            self.assertTrue(original_dates[0].startswith("2001-02-03T04:05:06"))
            self.assertTrue(
                hook.rewrite_linear_commits_stripping_agent_coauthor(
                    str(repo),
                    [
                        git_output(repo, ["rev-parse", "HEAD"]).strip(),
                        git_output(repo, ["rev-parse", "HEAD~1"]).strip(),
                    ],
                )
            )
            rewritten_dates = git_output(
                repo, ["log", "-2", "--format=%cI"]
            ).splitlines()
            self.assertEqual(rewritten_dates, original_dates)
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_rewrite_tries_sign_for_each_chained_commit(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, subject="second")
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            run_git_in(repo, ["config", "commit.gpgsign", "true"])
            signed_attempts = 0
            real_try_sign = hook.try_signed_commit_tree

            def try_sign_proxy(*args: object, **kwargs: object) -> str | None:
                nonlocal signed_attempts
                signed_attempts += 1
                return real_try_sign(*args, **kwargs)

            with patch.object(hook, "try_signed_commit_tree", side_effect=try_sign_proxy):
                self.assertTrue(
                    hook.rewrite_linear_commits_stripping_agent_coauthor(
                        str(repo),
                        [
                            git_output(repo, ["rev-parse", "HEAD"]).strip(),
                            git_output(repo, ["rev-parse", "HEAD~1"]).strip(),
                        ],
                    )
                )
            self.assertEqual(signed_attempts, 2)
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )

    def test_rewrite_signs_only_commits_that_were_signed(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, subject="second")
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            run_git_in(repo, ["config", "commit.gpgsign", "false"])
            write_fake_gpgsig_on_tip(repo)
            signed_attempts = 0

            def try_sign_proxy(*args: object, **kwargs: object) -> str | None:
                nonlocal signed_attempts
                signed_attempts += 1
                return None

            stderr = io.StringIO()
            with (
                contextlib.redirect_stderr(stderr),
                patch.object(hook, "try_signed_commit_tree", side_effect=try_sign_proxy),
            ):
                self.assertTrue(
                    hook.rewrite_linear_commits_stripping_agent_coauthor(
                        str(repo),
                        [
                            git_output(repo, ["rev-parse", "HEAD"]).strip(),
                            git_output(repo, ["rev-parse", "HEAD~1"]).strip(),
                        ],
                    )
                )
            self.assertEqual(signed_attempts, 1)
            self.assertIn("falling back to unsigned", stderr.getvalue())

    def test_rewrite_stops_signing_after_first_failure(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, subject="second")
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            run_git_in(repo, ["config", "commit.gpgsign", "true"])
            signed_attempts = 0

            def try_sign_proxy(*args: object, **kwargs: object) -> str | None:
                nonlocal signed_attempts
                signed_attempts += 1
                return None

            stderr = io.StringIO()
            with (
                contextlib.redirect_stderr(stderr),
                patch.object(hook, "try_signed_commit_tree", side_effect=try_sign_proxy),
            ):
                self.assertTrue(
                    hook.rewrite_linear_commits_stripping_agent_coauthor(
                        str(repo),
                        [
                            git_output(repo, ["rev-parse", "HEAD"]).strip(),
                            git_output(repo, ["rev-parse", "HEAD~1"]).strip(),
                        ],
                    )
                )
            self.assertEqual(signed_attempts, 1)
            self.assertIn("falling back to unsigned", stderr.getvalue())
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )

    def test_rewrite_does_not_move_head_when_commit_tree_fails(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, subject="second")
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            run_git_in(repo, ["config", "commit.gpgsign", "false"])
            original_head = git_output(repo, ["rev-parse", "HEAD"]).strip()
            calls = 0
            real_unsigned = hook.unsigned_commit_tree

            def fail_second(*args: object, **kwargs: object):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return real_unsigned(*args, **kwargs)
                return subprocess.CompletedProcess(
                    ["git", "commit-tree"], 1, "", "forced failure\n"
                )

            stderr = io.StringIO()
            with (
                contextlib.redirect_stderr(stderr),
                patch.object(hook, "unsigned_commit_tree", side_effect=fail_second),
            ):
                self.assertFalse(
                    hook.rewrite_linear_commits_stripping_agent_coauthor(
                        str(repo),
                        [
                            git_output(repo, ["rev-parse", "HEAD"]).strip(),
                            git_output(repo, ["rev-parse", "HEAD~1"]).strip(),
                        ],
                    )
                )
            self.assertIn("strip-agent-coauthor:", stderr.getvalue())
            self.assertIn("git commit-tree failed", stderr.getvalue())
            self.assertIn("forced failure", stderr.getvalue())
            self.assertEqual(git_output(repo, ["rev-parse", "HEAD"]).strip(), original_head)

    def test_rewrite_does_not_move_head_when_tip_changed(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, subject="second")
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            run_git_in(repo, ["config", "commit.gpgsign", "false"])
            hashes = [
                git_output(repo, ["rev-parse", "HEAD"]).strip(),
                git_output(repo, ["rev-parse", "HEAD~1"]).strip(),
            ]
            real_run_git = hook.run_git

            def steal_tip_before_update_ref(
                args: list[str],
                *,
                cwd: str | None = None,
                env: dict[str, str] | None = None,
                input_text: str | None = None,
                timeout: float | None = None,
            ) -> subprocess.CompletedProcess[str]:
                if args[:2] == ["update-ref", "HEAD"]:
                    (repo / "tracked.txt").write_text("stolen\n", encoding="utf-8")
                    run_git_in(repo, ["add", "tracked.txt"])
                    run_git_in(repo, ["commit", "--no-gpg-sign", "-m", "stolen"])
                return real_run_git(
                    args, cwd=cwd, env=env, input_text=input_text, timeout=timeout
                )

            stderr = io.StringIO()
            with (
                contextlib.redirect_stderr(stderr),
                patch.object(hook, "run_git", side_effect=steal_tip_before_update_ref),
            ):
                self.assertFalse(
                    hook.rewrite_linear_commits_stripping_agent_coauthor(
                        str(repo), hashes
                    )
                )
            self.assertIn("strip-agent-coauthor:", stderr.getvalue())
            self.assertIn("git update-ref HEAD failed", stderr.getvalue())
            self.assertEqual(
                git_output(repo, ["log", "-1", "--format=%s"]).strip(),
                "stolen",
            )
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )


class GitIndexLockAndGpgWrapperTests(unittest.TestCase):
    def test_clear_stale_git_index_lock_uses_git_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            main = Path(tmp) / "main"
            worktree = Path(tmp) / "wt"
            main.mkdir()
            init_repo(main)
            run_git_in(main, ["worktree", "add", str(worktree)])
            lock = Path(
                git_output(worktree, ["rev-parse", "--git-path", "index.lock"]).strip()
            )
            lock.write_text("", encoding="utf-8")
            self.assertTrue(lock.exists())
            hook.clear_stale_git_index_lock(str(worktree))
            self.assertFalse(lock.exists())

    def test_clear_stale_git_index_lock_keeps_preexisting_lock(self) -> None:
        with initialized_temporary_repo() as repo:
            lock = Path(hook.git_index_lock_path(str(repo)) or "")
            self.assertTrue(str(lock))
            lock.write_text("", encoding="utf-8")
            hook.clear_stale_git_index_lock(str(repo), existed_before=True)
            self.assertTrue(lock.exists())
            lock.unlink()

    def test_gpg_wrapper_unlinks_tempfile_when_chmod_fails(self) -> None:
        created: list[str] = []
        real_mkstemp = tempfile.mkstemp

        def tracking_mkstemp(*args: object, **kwargs: object):
            fd, path = real_mkstemp(*args, **kwargs)
            created.append(path)
            return fd, path

        with (
            patch.object(tempfile, "mkstemp", tracking_mkstemp),
            patch.object(os, "chmod", side_effect=OSError("chmod failed")),
        ):
            with self.assertRaises(OSError):
                hook.gpg_pinentry_error_wrapper_path(None)
        self.assertEqual(len(created), 1)
        self.assertFalse(os.path.exists(created[0]))


class PostToolUseTests(unittest.TestCase):
    def test_post_tool_strips_quiet_commit_without_summary(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, quiet=True)
            hook.handle_post_tool_use(
                post_tool_payload("git commit --quiet -m second", repo, "")
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_does_not_amend_failed_quiet_commit(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            original_head = git_output(repo, ["rev-parse", "HEAD"])
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit --quiet -m second",
                    repo,
                    "",
                    exit_code=1,
                )
            )
            self.assertEqual(git_output(repo, ["rev-parse", "HEAD"]), original_head)
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_does_not_strip_parent_forged_by_log_suffix(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo, subject="first")
            (repo / "tracked.txt").write_text("two\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"second\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            parent_short = git_output(repo, ["rev-parse", "--short=7", "HEAD~1"]).strip()
            tip_summary = reported_commit_summary(repo, "second")
            forged_parent = f"[master {parent_short}] first\n"
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second && "
                    "git log -1 --format='[master %h] first' HEAD~1",
                    repo,
                    tip_summary + forged_parent,
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )

    def test_post_tool_strips_only_the_reported_new_tip(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second",
                    repo,
                    reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_strips_commit_followed_by_git_status(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second && git status",
                    repo,
                    reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_strips_tip_after_prior_commit_in_same_shell(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo, subject="first")
            (repo / "tracked.txt").write_text("two\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"second\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            first_summary = reported_commit_summary(repo, "second")
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            second_summary = reported_commit_summary(repo, "third")
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second && git commit -m third",
                    repo,
                    first_summary + second_summary,
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )
            # Out-of-band ancestor (not in this Shell) keeps its trailer.
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~2"]),
            )

    def test_post_tool_strips_quiet_chained_commits(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, subject="second", quiet=True)
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--quiet",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit --quiet -m second && git commit --quiet -m third",
                    repo,
                    "",
                    exit_code=0,
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )

    def test_post_tool_does_not_strip_unreported_semicolon_parent(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo, subject="first")
            (repo / "tracked.txt").write_text("two\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"second\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second; git commit -m third",
                    repo,
                    reported_commit_summary(repo, "third"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )

    def test_post_tool_does_not_strip_parent_after_amend_in_same_shell(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo, subject="first")
            (repo / "tracked.txt").write_text("two\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"second\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            second_summary = reported_commit_summary(repo, "second")
            run_git_in(
                repo,
                [
                    "commit",
                    "--amend",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second && git commit --amend -m third",
                    repo,
                    second_summary + reported_commit_summary(repo, "third"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )

    def test_post_tool_quiet_chain_then_amend_does_not_strip_oob_parent(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo, subject="oob")
            (repo / "tracked.txt").write_text("two\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--quiet",
                    "--no-gpg-sign",
                    "-m",
                    f"second\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--quiet",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            run_git_in(
                repo,
                [
                    "commit",
                    "--amend",
                    "--no-gpg-sign",
                    "-m",
                    f"amended\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit --quiet -m second && "
                    "git commit --quiet -m third && "
                    "git commit --amend -m amended",
                    repo,
                    reported_commit_summary(repo, "amended"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~2"]),
            )

    def test_post_tool_quiet_then_loud_amend_still_strips_quiet_parent(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo, subject="oob")
            (repo / "tracked.txt").write_text("two\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--quiet",
                    "--no-gpg-sign",
                    "-m",
                    f"second\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            (repo / "tracked.txt").write_text("three\n", encoding="utf-8")
            run_git_in(repo, ["add", "tracked.txt"])
            run_git_in(
                repo,
                [
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    f"third\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            third_summary = reported_commit_summary(repo, "third")
            run_git_in(
                repo,
                [
                    "commit",
                    "--amend",
                    "--no-gpg-sign",
                    "-m",
                    f"amended\n\n{AGENT_COAUTHOR_TRAILER}",
                ],
            )
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit --quiet -m second && "
                    "git commit -m third && "
                    "git commit --amend -m amended",
                    repo,
                    third_summary + reported_commit_summary(repo, "amended"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~2"]),
            )

    def test_post_tool_does_not_strip_parent_for_other_directory_prefix_commit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            repo = workspace / "repo"
            other = workspace / "other"
            repo.mkdir()
            other.mkdir()
            init_repo(repo)
            init_repo(other)
            replace_tip_message_with_agent_coauthor(repo, subject="first")
            commit_tracked_change_with_agent_coauthor(repo)
            (other / "tracked.txt").write_text("other\n", encoding="utf-8")
            run_git_in(other, ["add", "tracked.txt"])
            run_git_in(other, ["commit", "--no-gpg-sign", "-m", "other"])
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git -C ../other commit -m other && git commit -m second",
                    repo,
                    reported_commit_summary(other, "other")
                    + reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B", "HEAD~1"]),
            )

    def test_post_tool_strips_newline_separated_commit_then_git_status(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second\ngit status",
                    repo,
                    reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_strips_and_log_then_semicolon_status(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second && git log -1 ; git status",
                    repo,
                    reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_strips_when_tool_output_is_a_dict(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                {
                    "hook_event_name": "postToolUse",
                    "tool_name": "Shell",
                    "tool_input": {
                        "command": "git commit -m second",
                        "working_directory": str(repo),
                    },
                    "tool_output": {
                        "stdout": reported_commit_summary(repo, "second"),
                        "exitCode": 0,
                    },
                    "cwd": str(repo),
                }
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_strips_commit_with_stderr_redirect(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second 2>&1 && git status",
                    repo,
                    reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_strips_quiet_commit_followed_by_git_status(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo, quiet=True)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit --quiet -m second && git status",
                    repo,
                    "",
                    exit_code=0,
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_strips_status_then_commit(self) -> None:
        with initialized_temporary_repo() as repo:
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git status && git commit -m second",
                    repo,
                    reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_does_not_amend_quiet_commit_then_semicolon_true(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            original_head = git_output(repo, ["rev-parse", "HEAD"])
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit --quiet -m second; true",
                    repo,
                    "",
                    exit_code=0,
                )
            )
            self.assertEqual(git_output(repo, ["rev-parse", "HEAD"]), original_head)
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_does_not_amend_semicolon_forged_log_summary(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            original_head = git_output(repo, ["rev-parse", "HEAD"])
            short_head = original_head.strip()[:7]
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second; "
                    "git log -1 --format='[master %h] first'",
                    repo,
                    f"[master {short_head}] first\n",
                    exit_code=0,
                )
            )
            self.assertEqual(git_output(repo, ["rev-parse", "HEAD"]), original_head)
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_does_not_amend_semicolon_verbose_status(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            original_head = git_output(repo, ["rev-parse", "HEAD"])
            short_head = original_head.strip()[:7]
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git commit -m second; git status -v",
                    repo,
                    f"[master {short_head}] first\n",
                    exit_code=0,
                )
            )
            self.assertEqual(git_output(repo, ["rev-parse", "HEAD"]), original_head)
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_does_not_amend_forged_summary_when_exit_nonzero(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            original_head = git_output(repo, ["rev-parse", "HEAD"])
            short_head = original_head.strip()[:7]
            # status is a safe prefix; a non-zero exit must still block amend
            # even when stdout contains a tip-matching summary line.
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git status && git commit -m second",
                    repo,
                    f"[master {short_head}] first\n",
                    exit_code=1,
                )
            )
            self.assertEqual(git_output(repo, ["rev-parse", "HEAD"]), original_head)
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_uses_git_minus_c_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            repo = workspace / "repo"
            repo.mkdir()
            init_repo(repo)
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git -C repo commit -m second",
                    workspace,
                    reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_uses_attached_git_minus_c_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            repo = workspace / "repo"
            repo.mkdir()
            init_repo(repo)
            commit_tracked_change_with_agent_coauthor(repo)
            hook.handle_post_tool_use(
                post_tool_payload(
                    "git -Crepo commit -m second",
                    workspace,
                    reported_commit_summary(repo, "second"),
                )
            )
            self.assertNotIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )

    def test_post_tool_does_not_amend_an_ambiguous_or_unreported_tip(self) -> None:
        with initialized_temporary_repo() as repo:
            replace_tip_message_with_agent_coauthor(repo)
            original_head = git_output(repo, ["rev-parse", "HEAD"])
            short_head = original_head.strip()[:7]
            for command, output in (
                (
                    "git commit -m nochange || true",
                    "nothing to commit, working tree clean\n",
                ),
                ("git commit -m x && false", f"[master {short_head}] first\n"),
                ("git commit-tree HEAD^{tree}", f"[master {short_head}] first\n"),
                (
                    "git log -1 --format='[master %h]'; git commit --dry-run",
                    f"[master {short_head}] first\n",
                ),
                (
                    "git log -1 --format='[master %h]'; git commit --short",
                    f"[master {short_head}] first\n",
                ),
                (
                    "git log -1 --format='[master %h]'; git commit -zq",
                    f"[master {short_head}] first\n",
                ),
                (
                    "export GIT_DIR=/other/.git && git commit -m x",
                    f"[master {short_head}] first\n",
                ),
                (
                    "false && git commit -m x",
                    f"[master {short_head}] first\n",
                ),
                (
                    "git log -1 --format='[master %h]' && git commit -m x",
                    f"[master {short_head}] first\n",
                ),
                (
                    "git log -1 --format='[master %h]'; false && git commit -m x",
                    f"[master {short_head}] first\n",
                ),
                (
                    "git commit -m x; git log -1 --format='[master %h] first'",
                    f"[master {short_head}] first\n",
                ),
                ("git commit -m x", f"[master {original_head.strip()[:4]}] first\n"),
                ("git commit -m x", "[master deadbee] x\n"),
            ):
                hook.handle_post_tool_use(post_tool_payload(command, repo, output))

            self.assertEqual(git_output(repo, ["rev-parse", "HEAD"]), original_head)
            self.assertIn(
                "cursoragent@cursor.com",
                git_output(repo, ["log", "-1", "--format=%B"]),
            )


class StripEligibleStatementTests(unittest.TestCase):
    def test_count_strip_eligible_skips_dry_run(self) -> None:
        self.assertEqual(
            count_strip_eligible_statements(
                "git commit --dry-run -m x && git commit -m y"
            ),
            1,
        )
        self.assertEqual(
            count_strip_eligible_statements(
                "git commit --quiet -m a && git commit --quiet -m b"
            ),
            2,
        )
        self.assertEqual(
            count_strip_eligible_statements(
                "git commit -m x && git commit --amend -m y"
            ),
            1,
        )
        self.assertEqual(
            count_strip_eligible_statements(
                "git -C /other commit -m x && git commit -m y",
                cwd="/workspace",
            ),
            1,
        )
        self.assertEqual(
            count_strip_eligible_statements(
                "git commit -m x && git commit --amen -m y"
            ),
            1,
        )
        self.assertTrue(
            hook.git_commit_is_amend(["git", "commit", "--amen", "-m", "x"], 1)
        )
        self.assertTrue(
            hook.git_commit_is_amend(["git", "commit", "--am", "-m", "x"], 1)
        )
        self.assertFalse(
            hook.git_commit_is_amend(["git", "commit", "--a", "-m", "x"], 1)
        )
        self.assertTrue(
            hook.git_commit_is_quiet(["git", "commit", "--qui", "-m", "x"], 1)
        )
        self.assertTrue(
            hook.git_commit_is_quiet(["git", "commit", "--qu", "-m", "x"], 1)
        )
        self.assertTrue(
            hook.git_commit_is_quiet(["git", "commit", "--q", "-m", "x"], 1)
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
